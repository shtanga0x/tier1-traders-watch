/**
 * Compute aggregated portfolio data from raw trader positions and activity
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  fetchWalletPositions,
  fetchWalletActivity,
  fetchWalletValue,
  batchFetch
} from './polymarket_api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');

/**
 * Parse CSV file
 */
function parseCSV(content) {
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    if (values.length >= 2 && values[0]) {
      const row = {};
      headers.forEach((h, idx) => {
        row[h] = values[idx] || '';
      });
      rows.push(row);
    }
  }
  return rows;
}

/**
 * Load traders from CSV
 */
export function loadTraders() {
  const csvPath = path.join(ROOT_DIR, 'data', 'tier1_traders.csv');
  const content = fs.readFileSync(csvPath, 'utf-8');
  return parseCSV(content);
}

/**
 * Load config
 */
export function loadConfig() {
  const configPath = path.join(ROOT_DIR, 'config.json');
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }
  return {
    poll_interval_seconds: 300,
    max_recent_events: 200,
    min_usd_filter: 50,
    concurrency_limit: 5
  };
}

/**
 * Compute exposure from position
 */
function computeExposure(position) {
  // Use currentValue if available, otherwise use size * price, or just size
  if (position.currentValue !== undefined && position.currentValue !== null) {
    return Math.abs(parseFloat(position.currentValue));
  }
  if (position.size !== undefined && position.curPrice !== undefined) {
    return Math.abs(parseFloat(position.size) * parseFloat(position.curPrice));
  }
  if (position.size !== undefined) {
    return Math.abs(parseFloat(position.size));
  }
  return 0;
}

/**
 * Fetch and process all trader portfolios
 */
export async function fetchAllPortfolios(traders, config) {
  console.log(`Fetching portfolios for ${traders.length} traders...`);

  const traderPortfolios = {};
  const concurrency = config.concurrency_limit || 5;

  // Fetch positions for all traders
  const positionsResults = await batchFetch(
    traders.map(t => t.address),
    fetchWalletPositions,
    concurrency,
    config
  );

  // Fetch values for all traders
  const valuesResults = await batchFetch(
    traders.map(t => t.address),
    fetchWalletValue,
    concurrency,
    config
  );

  // Build trader portfolios with PnL
  for (const trader of traders) {
    const addr = trader.address.toLowerCase();
    const posResult = positionsResults.get(addr);
    const valResult = valuesResults.get(addr);
    const positions = posResult?.success ? posResult.data : [];

    // Calculate total PnL from positions (cashPnl is all-time realized + unrealized)
    let totalPnL = 0;
    for (const pos of positions) {
      const pnl = parseFloat(pos.cashPnl || pos.pnl || 0);
      totalPnL += pnl;
    }

    traderPortfolios[addr] = {
      address: addr,
      label: trader.label,
      tier: trader.tier || '1',
      positions: positions,
      totalValue: valResult?.success ? valResult.data : 0,
      totalPnL: Math.round(totalPnL * 100) / 100,
      fetchSuccess: posResult?.success && valResult?.success,
      lastUpdated: new Date().toISOString()
    };
  }

  return traderPortfolios;
}

/**
 * Fetch recent activity for all traders
 */
export async function fetchAllActivity(traders, config) {
  console.log(`Fetching activity for ${traders.length} traders...`);

  const allActivity = [];
  const concurrency = config.concurrency_limit || 5;
  const maxEvents = config.max_recent_events || 200;

  // Calculate timestamp for 30 days ago
  const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
  const activityLimit = config.activity_limit_per_trader || 500;

  const activityResults = await batchFetch(
    traders.map(t => t.address),
    (address, cfg) => fetchWalletActivity(address, thirtyDaysAgo, activityLimit, cfg),
    concurrency,
    config
  );

  // Map trader addresses to labels
  const labelMap = new Map(traders.map(t => [t.address.toLowerCase(), t.label]));

  // Combine all activity
  for (const [address, result] of activityResults) {
    if (result.success && result.data) {
      for (const activity of result.data) {
        allActivity.push({
          ...activity,
          traderAddress: address,
          traderLabel: labelMap.get(address) || address.slice(0, 10)
        });
      }
    }
  }

  // Sort by timestamp descending and limit
  allActivity.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  return allActivity.slice(0, maxEvents);
}

/**
 * Build 24h change map from activity
 */
function build24hChangeMap(activity) {
  const now = Math.floor(Date.now() / 1000);
  const cutoff24h = now - 24 * 3600;
  const changeMap = new Map();

  for (const a of activity) {
    if ((a.timestamp || 0) < cutoff24h) continue;
    if (a.type && a.type !== 'TRADE') continue;

    // Create key matching position aggregation
    const outcomeIdx = a.outcomeIndex !== undefined ? a.outcomeIndex : (a.outcome === 'Yes' ? 1 : 0);
    const key = `${a.conditionId}-${outcomeIdx}`;

    const delta = a.side === 'BUY'
      ? parseFloat(a.usdcSize || a.size || 0)
      : -parseFloat(a.usdcSize || a.size || 0);

    changeMap.set(key, (changeMap.get(key) || 0) + delta);
  }

  return changeMap;
}

/**
 * Aggregate positions across all traders
 */
export function aggregatePortfolios(traderPortfolios, config, activity = []) {
  // Build 24h change map from activity
  const change24hMap = build24hChangeMap(activity);

  // Map: conditionId-outcome -> aggregated data
  const aggregated = new Map();

  for (const [address, portfolio] of Object.entries(traderPortfolios)) {
    if (!portfolio.positions || !portfolio.fetchSuccess) continue;

    for (const pos of portfolio.positions) {
      // Determine outcome index and string
      let outcomeIndex = pos.outcomeIndex;
      let outcomeStr = pos.outcome;

      if (outcomeIndex === undefined) {
        outcomeIndex = outcomeStr === 'Yes' ? 1 : 0;
      }
      if (!outcomeStr) {
        outcomeStr = outcomeIndex === 0 ? 'No' : 'Yes';
      }

      const key = `${pos.conditionId}-${outcomeIndex}`;

      if (!aggregated.has(key)) {
        aggregated.set(key, {
          conditionId: pos.conditionId,
          title: pos.title || 'Unknown Market',
          slug: pos.slug || '',
          icon: pos.icon || '',
          eventSlug: pos.eventSlug || '',
          outcome: outcomeStr,
          outcomeIndex: outcomeIndex,
          traders: [],
          totalExposure: 0,
          positions: [],
          weightedAvgPriceSum: 0,
          totalSize: 0,
          curPrice: 0
        });
      }

      const agg = aggregated.get(key);
      const exposure = computeExposure(pos);
      const avgPrice = parseFloat(pos.avgPrice || 0);
      const curPrice = parseFloat(pos.curPrice || 0);
      const size = parseFloat(pos.size || 0);

      agg.traders.push({
        address,
        label: traderPortfolios[address].label,
        exposure,
        size,
        avgPrice,
        curPrice
      });
      agg.totalExposure += exposure;
      agg.positions.push(pos);

      // Track weighted average entry price
      if (avgPrice > 0 && size > 0) {
        agg.weightedAvgPriceSum += avgPrice * size;
        agg.totalSize += size;
      }
      // Use the most recent curPrice
      if (curPrice > 0) {
        agg.curPrice = curPrice;
      }
    }
  }

  // Convert to array with 24h changes and price data
  const positions = Array.from(aggregated.entries()).map(([key, agg]) => {
    // Calculate weighted average entry price
    const avgEntry = agg.totalSize > 0
      ? agg.weightedAvgPriceSum / agg.totalSize
      : 0;
    const curPrice = agg.curPrice;

    // Calculate price change percentage from entry
    let priceChangePct = 0;
    if (avgEntry > 0 && curPrice > 0) {
      priceChangePct = ((curPrice - avgEntry) / avgEntry) * 100;
    }

    return {
      conditionId: agg.conditionId,
      title: agg.title,
      slug: agg.slug,
      icon: agg.icon,
      eventSlug: agg.eventSlug,
      outcome: agg.outcome,
      outcomeIndex: agg.outcomeIndex,
      traderCount: agg.traders.length,
      traders: agg.traders,
      totalExposure: agg.totalExposure,
      change24h: Math.round((change24hMap.get(key) || 0) * 100) / 100,
      avgEntry: Math.round(avgEntry * 100) / 100,
      curPrice: Math.round(curPrice * 100) / 100,
      priceChangePct: Math.round(priceChangePct * 10) / 10
    };
  });

  // Sort by total exposure descending
  positions.sort((a, b) => b.totalExposure - a.totalExposure);

  // Compute summary stats
  const totalExposure = positions.reduce((sum, p) => sum + p.totalExposure, 0);
  const distinctMarkets = new Set(positions.map(p => p.conditionId)).size;

  // Concentration metrics
  let top1Share = 0;
  let top5Share = 0;
  if (totalExposure > 0) {
    top1Share = positions.length > 0 ? positions[0].totalExposure / totalExposure : 0;
    top5Share = positions.slice(0, 5).reduce((sum, p) => sum + p.totalExposure, 0) / totalExposure;
  }

  return {
    positions: positions.filter(p => p.totalExposure >= (config.min_usd_filter || 0)),
    summary: {
      totalExposure,
      distinctMarkets,
      top1Share: Math.round(top1Share * 100) / 100,
      top5Share: Math.round(top5Share * 100) / 100,
      netFlow24h: 0 // Will be computed from activity
    }
  };
}

/**
 * Process activity into recent changes format
 */
export function processRecentChanges(activity, traderPortfolios) {
  const now = Math.floor(Date.now() / 1000);
  const windows = {
    '1h': now - 3600,
    '6h': now - 6 * 3600,
    '24h': now - 24 * 3600,
    '7d': now - 7 * 24 * 3600,
    '30d': now - 30 * 24 * 3600
  };

  const windowSummaries = {
    '1h': 0,
    '6h': 0,
    '24h': 0,
    '7d': 0,
    '30d': 0
  };

  const changes = activity
    .filter(a => a.type === 'TRADE' || !a.type) // Focus on trades
    .map(a => {
      const delta = a.side === 'BUY'
        ? parseFloat(a.usdcSize || a.size || 0)
        : -parseFloat(a.usdcSize || a.size || 0);

      // Update window summaries
      const ts = a.timestamp || 0;
      for (const [window, threshold] of Object.entries(windows)) {
        if (ts >= threshold) {
          windowSummaries[window] += delta;
        }
      }

      // Determine action type
      let action = 'unknown';
      if (a.side === 'BUY') {
        action = 'increased';
      } else if (a.side === 'SELL') {
        action = 'decreased';
      }

      // Determine outcome
      let outcome = a.outcome || '';
      if (!outcome && a.outcomeIndex !== undefined) {
        outcome = a.outcomeIndex === 0 ? 'No' : 'Yes';
      }

      return {
        timestamp: ts,
        trader: a.traderLabel || a.proxyWallet?.slice(0, 10),
        traderAddress: a.traderAddress || a.proxyWallet,
        market: a.title || 'Unknown Market',
        marketSlug: a.slug || '',
        eventSlug: a.eventSlug || '',
        conditionId: a.conditionId || '',
        outcome: outcome,
        outcomeIndex: a.outcomeIndex,
        action,
        delta: Math.round(delta * 100) / 100,
        size: parseFloat(a.size || 0),
        price: parseFloat(a.price || 0)
      };
    });

  // Round summaries
  for (const key of Object.keys(windowSummaries)) {
    windowSummaries[key] = Math.round(windowSummaries[key] * 100) / 100;
  }

  return {
    changes,
    windowSummaries
  };
}

/**
 * Main computation function
 */
export async function computeAll() {
  const config = loadConfig();
  const traders = loadTraders();

  console.log(`Loaded ${traders.length} traders from CSV`);
  console.log('Config:', config);

  // Fetch all data
  const traderPortfolios = await fetchAllPortfolios(traders, config);
  const activity = await fetchAllActivity(traders, config);

  // Aggregate - pass activity for 24h change calculation
  const aggregatedPortfolio = aggregatePortfolios(traderPortfolios, config, activity);
  const recentChanges = processRecentChanges(activity, traderPortfolios);

  // Update 24h flow in summary
  aggregatedPortfolio.summary.netFlow24h = recentChanges.windowSummaries['24h'];

  // Generate metadata
  const metadata = {
    last_updated: new Date().toISOString(),
    trader_count: traders.length,
    traders_fetched: Object.values(traderPortfolios).filter(p => p.fetchSuccess).length,
    market_count: aggregatedPortfolio.summary.distinctMarkets,
    total_exposure: aggregatedPortfolio.summary.totalExposure,
    activity_count: activity.length
  };

  return {
    metadata,
    aggregatedPortfolio,
    traderPortfolios,
    recentChanges
  };
}

export default {
  loadTraders,
  loadConfig,
  fetchAllPortfolios,
  fetchAllActivity,
  aggregatePortfolios,
  processRecentChanges,
  computeAll
};
