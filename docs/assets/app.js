/**
 * Tier1 Traders Watch - Frontend Application
 */

const DATA_BASE = 'data';
const POLYMARKET_BASE = 'https://polymarket.com';
const REFERRAL = '?via=delta';
const INACTIVITY_TIMEOUT = 20 * 60 * 1000; // 20 minutes

// State
let metadata = null;
let traderPortfolios = null;
let aggregatedPortfolio = null;
let recentChanges = null;
let lastActivityTime = Date.now();
let inactivityTimer = null;

// Portfolio sort state
let portfolioSort = { column: 'totalExposure', direction: 'desc' };

// DOM Elements
const tabs = document.querySelectorAll('.tab');
const sections = document.querySelectorAll('.section');

/**
 * Fetch JSON data
 */
async function fetchJSON(filename) {
  const response = await fetch(`${DATA_BASE}/${filename}?t=${Date.now()}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${filename}`);
  }
  return response.json();
}

/**
 * Format currency
 */
function formatUSD(value) {
  const num = parseFloat(value) || 0;
  if (Math.abs(num) >= 1000000) {
    return '$' + (num / 1000000).toFixed(2) + 'M';
  }
  if (Math.abs(num) >= 1000) {
    return '$' + (num / 1000).toFixed(1) + 'K';
  }
  return '$' + num.toFixed(2);
}

/**
 * Format price as cents
 */
function formatCents(value) {
  const num = parseFloat(value) || 0;
  return Math.round(num * 100) + 'c';
}

/**
 * Format relative time
 */
function formatRelativeTime(timestamp) {
  const now = Date.now() / 1000;
  const diff = now - timestamp;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/**
 * Format date as "04 Jan 2026"
 */
function formatExpirationDate(dateStr) {
  if (!dateStr) return '-';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '-';
    const day = date.getDate().toString().padStart(2, '0');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    return `${day} ${month} ${year}`;
  } catch {
    return '-';
  }
}

/**
 * Parse date string to timestamp for sorting
 */
function parseExpirationDate(dateStr) {
  if (!dateStr) return 0;
  try {
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? 0 : date.getTime();
  } catch {
    return 0;
  }
}

/**
 * Truncate address
 */
function truncateAddress(address) {
  if (!address) return '';
  return address.slice(0, 6) + '...' + address.slice(-4);
}

/**
 * Copy to clipboard
 */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build Polymarket URL with referral
 */
function polymarketUrl(path) {
  return `${POLYMARKET_BASE}${path}${REFERRAL}`;
}

/**
 * Update last updated display
 */
function updateLastUpdated() {
  const el = document.getElementById('last-updated');
  if (!metadata?.last_updated) {
    el.querySelector('.timestamp').textContent = 'No data';
    el.querySelector('.status-dot').classList.add('stale');
    return;
  }

  const updated = new Date(metadata.last_updated);
  const now = new Date();
  const diffMinutes = (now - updated) / 60000;

  el.querySelector('.timestamp').textContent = `Updated ${formatRelativeTime(updated.getTime() / 1000)}`;

  if (diffMinutes > 30) {
    el.querySelector('.status-dot').classList.add('stale');
  } else {
    el.querySelector('.status-dot').classList.remove('stale');
  }
}

/**
 * Render traders table
 */
function renderTradersTable(searchTerm = '') {
  const tbody = document.getElementById('traders-tbody');
  if (!traderPortfolios) {
    tbody.innerHTML = '<tr><td colspan="8" class="loading">Loading...</td></tr>';
    return;
  }

  const traders = Object.values(traderPortfolios)
    .filter(t => {
      if (!searchTerm) return true;
      const term = searchTerm.toLowerCase();
      return t.label?.toLowerCase().includes(term) ||
             t.address?.toLowerCase().includes(term);
    })
    .sort((a, b) => (b.totalValue || 0) - (a.totalValue || 0));

  if (traders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="loading">No traders found</td></tr>';
    return;
  }

  tbody.innerHTML = traders.map((trader, idx) => {
    const pnlClass = (trader.totalPnL || 0) >= 0 ? 'positive' : 'negative';
    const pnlSign = (trader.totalPnL || 0) >= 0 ? '+' : '';

    return `
      <tr>
        <td>${idx + 1}</td>
        <td>
          <div class="trader-cell">
            <div class="trader-avatar">${trader.label?.charAt(0) || '?'}</div>
            <div>
              <a href="${polymarketUrl('/profile/' + trader.address)}" target="_blank" class="trader-label">${trader.label || 'Unknown'}</a>
              <div class="trader-address">${truncateAddress(trader.address)}</div>
            </div>
          </div>
        </td>
        <td>${formatUSD(trader.totalValue)}</td>
        <td>${formatUSD(trader.usdcBalance || 0)}</td>
        <td class="${pnlClass}">${pnlSign}${formatUSD(trader.totalPnL || 0)}</td>
        <td>${trader.positions?.length || 0}</td>
        <td>
          <span class="status-badge ${trader.fetchSuccess ? 'success' : 'error'}">
            ${trader.fetchSuccess ? 'OK' : 'Error'}
          </span>
        </td>
        <td>
          <button class="btn btn-copy" onclick="copyToClipboard('${trader.address}').then(() => this.textContent = 'Copied!').finally(() => setTimeout(() => this.textContent = 'Copy', 1500))">
            Copy
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * Render portfolio summary
 */
function renderPortfolioSummary() {
  if (!aggregatedPortfolio?.summary) return;

  const s = aggregatedPortfolio.summary;
  document.getElementById('total-exposure').textContent = formatUSD(s.totalExposure);
  document.getElementById('relative-exposure').textContent = s.relativeExposure.toFixed(1) + '%';
  document.getElementById('distinct-markets').textContent = s.distinctMarkets;
  document.getElementById('top1-share').textContent = (s.top1Share * 100).toFixed(1) + '%';
  document.getElementById('top5-share').textContent = (s.top5Share * 100).toFixed(1) + '%';

  const flow24h = document.getElementById('net-flow-24h');
  flow24h.textContent = formatUSD(s.netFlow24h);
  flow24h.className = 'card-value ' + (s.netFlow24h >= 0 ? 'positive' : 'negative');
}

/**
 * Sort positions for portfolio table
 */
function sortPositions(positions) {
  const sorted = [...positions].sort((a, b) => {
    let aVal, bVal;
    switch (portfolioSort.column) {
      case 'traderCount':
        aVal = a.traderCount || 0;
        bVal = b.traderCount || 0;
        break;
      case 'totalExposure':
        aVal = a.totalExposure || 0;
        bVal = b.totalExposure || 0;
        break;
      case 'change1h':
        aVal = a._change1h || 0;
        bVal = b._change1h || 0;
        break;
      case 'change1d':
        aVal = a._change1d || 0;
        bVal = b._change1d || 0;
        break;
      case 'change1w':
        aVal = a._change1w || 0;
        bVal = b._change1w || 0;
        break;
      case 'endDate':
        aVal = parseExpirationDate(a.endDate);
        bVal = parseExpirationDate(b.endDate);
        break;
      case 'title':
        aVal = a.title || '';
        bVal = b.title || '';
        return portfolioSort.direction === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      default:
        aVal = a.totalExposure || 0;
        bVal = b.totalExposure || 0;
    }
    return portfolioSort.direction === 'asc' ? aVal - bVal : bVal - aVal;
  });
  return sorted;
}

/**
 * Handle portfolio column sort click
 */
function handlePortfolioSort(column) {
  if (portfolioSort.column === column) {
    portfolioSort.direction = portfolioSort.direction === 'asc' ? 'desc' : 'asc';
  } else {
    portfolioSort.column = column;
    portfolioSort.direction = 'desc';
  }
  renderPortfolioTable();
}

/**
 * Get sort indicator
 */
function getSortIndicator(column) {
  if (portfolioSort.column !== column) return '';
  return portfolioSort.direction === 'asc' ? ' ▲' : ' ▼';
}

/**
 * Build 24h change tooltip content showing activities that contributed to the change
 */
function build24hTooltip(pos) {
  if (!recentChanges?.changes) return '';

  // Find activities in last 24h for this position
  const now = Date.now() / 1000;
  const cutoff24h = now - 24 * 3600;

  const activities = recentChanges.changes.filter(c => {
    return c.conditionId === pos.conditionId &&
           c.outcomeIndex === pos.outcomeIndex &&
           c.timestamp >= cutoff24h;
  });

  if (activities.length === 0) {
    // No activities, change might be from price movement
    if (pos.priceChangePct && Math.abs(pos.priceChangePct) > 0.1) {
      return `Price change: ${pos.priceChangePct >= 0 ? '+' : ''}${pos.priceChangePct.toFixed(1)}%`;
    }
    return '';
  }

  const lines = activities
    .slice(0, 5)
    .map(a => {
      const action = a.action === 'increased' ? 'bought' : 'sold';
      return `${a.trader} ${action} ${formatUSD(Math.abs(a.delta))}`;
    });

  if (activities.length > 5) {
    lines.push(`+${activities.length - 5} more trades...`);
  }

  return lines.join('<br>');
}

/**
 * Render portfolio table
 */
function renderPortfolioTable() {
  const tbody = document.getElementById('portfolio-tbody');
  const thead = document.getElementById('portfolio-thead');

  if (!aggregatedPortfolio?.positions) {
    tbody.innerHTML = '<tr><td colspan="8" class="loading">Loading...</td></tr>';
    return;
  }

  // Update header with sort indicators
  if (thead) {
    thead.innerHTML = `
      <tr>
        <th>#</th>
        <th class="sortable" onclick="handlePortfolioSort('title')">Market${getSortIndicator('title')}</th>
        <th>Side</th>
        <th class="sortable" onclick="handlePortfolioSort('endDate')">Expiration${getSortIndicator('endDate')}</th>
        <th>Avg Entry</th>
        <th class="sortable" onclick="handlePortfolioSort('traderCount')">Traders${getSortIndicator('traderCount')}</th>
        <th class="sortable" onclick="handlePortfolioSort('totalExposure')">Exposure${getSortIndicator('totalExposure')}</th>
        <th>% Alloc</th>
        <th class="sortable tooltip-header" onclick="handlePortfolioSort('change1h')">1h Change${getSortIndicator('change1h')}<span class="header-info">Hover for details</span></th>
        <th class="sortable tooltip-header" onclick="handlePortfolioSort('change1d')">1d Change${getSortIndicator('change1d')}<span class="header-info">Hover for details</span></th>
        <th class="sortable tooltip-header" onclick="handlePortfolioSort('change1w')">1w Change${getSortIndicator('change1w')}<span class="header-info">Hover for details</span></th>
      </tr>
    `;
  }

  const positions = sortPositions(aggregatedPortfolio.positions);
  if (positions.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="loading">No positions found</td></tr>';
    return;
  }

  // Calculate total exposure for allocation %
  const totalExposure = aggregatedPortfolio.summary?.totalExposure ||
    positions.reduce((sum, p) => sum + (p.totalExposure || 0), 0);

  tbody.innerHTML = positions.map((pos, idx) => {
    const marketUrl = pos.eventSlug
      ? polymarketUrl('/event/' + pos.eventSlug)
      : polymarketUrl('/market/' + pos.slug);

    const outcomeClass = pos.outcome === 'Yes' ? 'outcome-yes' : 'outcome-no';

    // Format entry price with change %
    let entryHtml = '-';
    if (pos.avgEntry > 0) {
      const changePct = pos.priceChangePct || 0;
      const changeClass = changePct >= 0 ? 'positive' : 'negative';
      const changeSign = changePct >= 0 ? '+' : '';
      entryHtml = `
        <div class="entry-price">
          <span class="entry-main">${formatCents(pos.avgEntry)}</span>
          <span class="entry-change ${changeClass}">(${changeSign}${changePct.toFixed(1)}%)</span>
        </div>
      `;
    }

    // Format trader count with change indicator
    const traderChange = pos.traderCountChange || 0;
    let traderCountHtml = `${pos.traderCount}`;
    if (traderChange !== 0) {
      const changeClass = traderChange > 0 ? 'positive' : 'negative';
      const changeSign = traderChange > 0 ? '+' : '';
      traderCountHtml = `${pos.traderCount} <span class="${changeClass}">(${changeSign}${traderChange})</span>`;
    }

    // Calculate allocation %
    const allocPct = totalExposure > 0 ? (pos.totalExposure / totalExposure) * 100 : 0;

    // Calculate 1h, 1d, 1w changes with details
    const changes = calculatePositionChanges(pos.conditionId, pos.outcomeIndex);

    // Store changes for sorting
    pos._change1h = changes.h1;
    pos._change1d = changes.d1;
    pos._change1w = changes.w1;

    const h1Class = changes.h1 >= 0 ? 'positive' : 'negative';
    const d1Class = changes.d1 >= 0 ? 'positive' : 'negative';
    const w1Class = changes.w1 >= 0 ? 'positive' : 'negative';

    const h1Sign = changes.h1 >= 0 ? '+' : '';
    const d1Sign = changes.d1 >= 0 ? '+' : '';
    const w1Sign = changes.w1 >= 0 ? '+' : '';

    return `
      <tr>
        <td>${idx + 1}</td>
        <td>
          <div class="market-cell">
            ${pos.icon ? `<img src="${pos.icon}" class="market-icon" alt="">` : '<div class="market-icon"></div>'}
            <a href="${marketUrl}" target="_blank" class="market-link">${pos.title || 'Unknown Market'}</a>
          </div>
        </td>
        <td><span class="${outcomeClass}">${pos.outcome || '-'}</span></td>
        <td class="expiration-date">${formatExpirationDate(pos.endDate)}</td>
        <td>${entryHtml}</td>
        <td>${traderCountHtml}</td>
        <td>${formatUSD(pos.totalExposure)}</td>
        <td>${allocPct.toFixed(2)}%</td>
        <td class="tooltip ${h1Class}">
          ${h1Sign}${formatUSD(changes.h1)}
          ${changes.h1Details.length > 0 ? `<span class="tooltip-text">${buildChangeTooltip(changes.h1Details)}</span>` : ''}
        </td>
        <td class="tooltip ${d1Class}">
          ${d1Sign}${formatUSD(changes.d1)}
          ${changes.d1Details.length > 0 ? `<span class="tooltip-text">${buildChangeTooltip(changes.d1Details)}</span>` : ''}
        </td>
        <td class="tooltip ${w1Class}">
          ${w1Sign}${formatUSD(changes.w1)}
          ${changes.w1Details.length > 0 ? `<span class="tooltip-text">${buildChangeTooltip(changes.w1Details)}</span>` : ''}
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * Render changes summary
 */
function renderChangesSummary() {
  if (!recentChanges?.windowSummaries) return;

  const ws = recentChanges.windowSummaries;
  const windows = ['1h', '6h', '24h', '7d', '30d'];

  windows.forEach(w => {
    const el = document.getElementById(`flow-${w}`);
    if (el) {
      const value = ws[w] || 0;
      el.textContent = formatUSD(value);
      el.className = 'card-value ' + (value >= 0 ? 'positive' : 'negative');
    }
  });
}

/**
 * Get trader's average entry price for a specific position
 */
function getTraderAvgEntry(traderAddress, conditionId, outcomeIndex) {
  if (!traderPortfolios) return null;

  const trader = traderPortfolios[traderAddress?.toLowerCase()];
  if (!trader?.positions) return null;

  const position = trader.positions.find(p =>
    p.conditionId === conditionId &&
    (p.outcomeIndex === outcomeIndex ||
     (p.outcome === 'Yes' && outcomeIndex === 1) ||
     (p.outcome === 'No' && outcomeIndex === 0))
  );

  return position?.avgPrice || null;
}

/**
 * Render changes table
 */
function renderChangesTable(deltaFilter = 0, timeFilter = 'all') {
  const tbody = document.getElementById('changes-tbody');
  if (!recentChanges?.changes) {
    tbody.innerHTML = '<tr><td colspan="8" class="loading">Loading...</td></tr>';
    return;
  }

  const now = Date.now() / 1000;
  const timeThresholds = {
    '1h': now - 3600,
    '6h': now - 6 * 3600,
    '24h': now - 24 * 3600,
    '7d': now - 7 * 24 * 3600,
    'all': 0
  };

  const changes = recentChanges.changes.filter(c => {
    if (Math.abs(c.delta) < deltaFilter) return false;
    if (timeFilter !== 'all' && c.timestamp < timeThresholds[timeFilter]) return false;
    return true;
  });

  if (changes.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="loading">No changes match filters</td></tr>';
    return;
  }

  tbody.innerHTML = changes.map(c => {
    const marketUrl = c.eventSlug
      ? polymarketUrl('/event/' + c.eventSlug)
      : polymarketUrl('/market/' + c.marketSlug);

    const actionClass = c.action === 'increased' ? 'action-increased' : 'action-decreased';
    const outcomeClass = c.outcome === 'Yes' ? 'outcome-yes' : 'outcome-no';

    // Get trader's average entry for this position
    const avgEntry = getTraderAvgEntry(c.traderAddress, c.conditionId, c.outcomeIndex);
    const avgEntryDisplay = avgEntry ? formatCents(avgEntry) : '-';

    // Format delta with trade price in brackets
    const tradePrice = c.price ? formatCents(c.price) : '';
    const deltaDisplay = `${c.delta >= 0 ? '+' : ''}${formatUSD(c.delta)}${tradePrice ? ` (${tradePrice})` : ''}`;

    return `
      <tr>
        <td>${formatRelativeTime(c.timestamp)}</td>
        <td>
          <a href="${polymarketUrl('/profile/' + c.traderAddress)}" target="_blank" class="market-link">${c.trader}</a>
        </td>
        <td>
          <a href="${marketUrl}" target="_blank" class="market-link">${c.market}</a>
        </td>
        <td><span class="${outcomeClass}">${c.outcome || '-'}</span></td>
        <td>${avgEntryDisplay}</td>
        <td class="${actionClass}">${c.action}</td>
        <td class="${c.delta >= 0 ? 'positive' : 'negative'}">${deltaDisplay}</td>
        <td>${formatUSD(Math.abs(c.size))}</td>
      </tr>
    `;
  }).join('');
}

/**
 * Switch tab
 */
function switchTab(sectionId) {
  tabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.section === sectionId);
  });
  sections.forEach(section => {
    section.classList.toggle('active', section.id === `${sectionId}-section`);
  });
}

/**
 * Initialize filters
 */
function initFilters() {
  const deltaFilter = document.getElementById('delta-filter');
  const timeFilter = document.getElementById('time-filter');

  deltaFilter?.addEventListener('change', () => {
    renderChangesTable(parseInt(deltaFilter.value), timeFilter.value);
  });

  timeFilter?.addEventListener('change', () => {
    renderChangesTable(parseInt(deltaFilter.value), timeFilter.value);
  });
}

/**
 * Initialize search
 */
function initSearch() {
  const searchInput = document.getElementById('trader-search');
  let debounceTimeout;

  searchInput?.addEventListener('input', () => {
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => {
      renderTradersTable(searchInput.value);
    }, 300);
  });
}

/**
 * Track user activity
 */
function trackActivity() {
  lastActivityTime = Date.now();
}

/**
 * Check for inactivity and show refresh prompt
 */
function checkInactivity() {
  const now = Date.now();
  const inactive = now - lastActivityTime > INACTIVITY_TIMEOUT;
  const statusDot = document.querySelector('.status-dot');

  if (inactive && statusDot) {
    statusDot.classList.add('stale');
  }
}

/**
 * Refresh data
 */
async function refreshData() {
  const btn = document.getElementById('refresh-btn');
  btn?.classList.add('loading');

  try {
    await loadData();
    lastActivityTime = Date.now();
  } finally {
    btn?.classList.remove('loading');
  }
}

/**
 * Initialize refresh button
 */
function initRefresh() {
  const btn = document.getElementById('refresh-btn');
  btn?.addEventListener('click', refreshData);

  // Track activity
  ['mousemove', 'keypress', 'click', 'scroll'].forEach(event => {
    document.addEventListener(event, trackActivity, { passive: true });
  });

  // Check inactivity every minute
  setInterval(checkInactivity, 60000);
}

/**
 * Load all data
 */
async function loadData() {
  try {
    [metadata, traderPortfolios, aggregatedPortfolio, recentChanges] = await Promise.all([
      fetchJSON('metadata.json'),
      fetchJSON('trader_portfolios.json'),
      fetchJSON('aggregated_portfolio.json'),
      fetchJSON('recent_changes.json')
    ]);

    updateLastUpdated();
    renderTradersTable();
    renderPortfolioSummary();
    renderPortfolioTable();
    renderChangesSummary();
    renderChangesTable();
  } catch (error) {
    console.error('Failed to load data:', error);
    document.getElementById('traders-tbody').innerHTML =
      '<tr><td colspan="7" class="loading">Failed to load data. Run the fetch script first.</td></tr>';
  }
}

/**
 * Initialize app
 */
function init() {
  // Tab switching
  tabs.forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.section));
  });

  initFilters();
  initSearch();
  initRefresh();
  initChecker();
  loadData();
}

// ============================================
// CHECKER SECTION
// ============================================

const POLYGON_RPC = 'https://polygon-rpc.com';
const USDC_NATIVE = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
const USDC_BRIDGED = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const DATA_API_BASE = 'https://data-api.polymarket.com';

/**
 * Fetch USDC balance from Polygon blockchain
 */
async function fetchUsdcBalance(address) {
  const addr = address.toLowerCase().replace('0x', '');
  const data = '0x70a08231000000000000000000000000' + addr;

  async function getBalance(tokenContract) {
    try {
      const response = await fetch(POLYGON_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_call',
          params: [{ to: tokenContract, data }, 'latest'],
          id: 1
        })
      });
      const result = await response.json();
      if (result.result && result.result !== '0x') {
        return parseInt(result.result, 16) / 1e6;
      }
      return 0;
    } catch {
      return 0;
    }
  }

  const [nativeBalance, bridgedBalance] = await Promise.all([
    getBalance(USDC_NATIVE),
    getBalance(USDC_BRIDGED)
  ]);

  return Math.round((nativeBalance + bridgedBalance) * 100) / 100;
}

/**
 * Fetch positions for a wallet from Polymarket API
 */
async function fetchCheckerPositions(address) {
  const url = `${DATA_API_BASE}/positions?user=${address.toLowerCase()}&limit=1000`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to fetch positions');
  return await response.json();
}

/**
 * Fetch portfolio value for a wallet
 */
async function fetchCheckerValue(address) {
  const url = `${DATA_API_BASE}/value?user=${address.toLowerCase()}`;
  const response = await fetch(url);
  if (!response.ok) return 0;
  const data = await response.json();
  if (!data || data.length === 0) return 0;
  return parseFloat(data[0]?.value || 0);
}

/**
 * Scrape profile for PnL data
 */
async function fetchCheckerPnL(address) {
  try {
    const response = await fetch(`https://polymarket.com/profile/${address}`, {
      headers: {
        'Accept': 'text/html'
      }
    });
    if (!response.ok) return null;
    const html = await response.text();
    const match = html.match(/__NEXT_DATA__[^>]*>({.*?})<\/script>/);
    if (!match) return null;
    const data = JSON.parse(match[1]);
    const queries = data.props?.pageProps?.dehydratedState?.queries || [];
    for (const q of queries) {
      const d = q.state?.data;
      if (d && typeof d.pnl === 'number') {
        return d.pnl;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Calculate time-windowed changes for a position from recent changes data
 */
function calculatePositionChanges(conditionId, outcomeIndex) {
  if (!recentChanges?.changes) return { h1: 0, d1: 0, w1: 0, h1Details: [], d1Details: [], w1Details: [] };

  const now = Date.now() / 1000;
  const cutoff1h = now - 3600;
  const cutoff1d = now - 86400;
  const cutoff1w = now - 7 * 86400;

  let h1 = 0, d1 = 0, w1 = 0;
  const h1Details = [], d1Details = [], w1Details = [];

  // Group changes by trader for each window
  const traderChanges1h = new Map();
  const traderChanges1d = new Map();
  const traderChanges1w = new Map();

  for (const c of recentChanges.changes) {
    if (c.conditionId !== conditionId) continue;
    if (c.outcomeIndex !== outcomeIndex &&
        !((c.outcome === 'Yes' && outcomeIndex === 1) || (c.outcome === 'No' && outcomeIndex === 0))) continue;

    const ts = c.timestamp || 0;
    const delta = c.delta || 0;

    if (ts >= cutoff1w) {
      w1 += delta;
      const trader = c.trader || c.traderAddress?.slice(0, 10);
      traderChanges1w.set(trader, (traderChanges1w.get(trader) || 0) + delta);
    }
    if (ts >= cutoff1d) {
      d1 += delta;
      const trader = c.trader || c.traderAddress?.slice(0, 10);
      traderChanges1d.set(trader, (traderChanges1d.get(trader) || 0) + delta);
    }
    if (ts >= cutoff1h) {
      h1 += delta;
      const trader = c.trader || c.traderAddress?.slice(0, 10);
      traderChanges1h.set(trader, (traderChanges1h.get(trader) || 0) + delta);
    }
  }

  // Convert trader maps to sorted arrays
  for (const [trader, change] of traderChanges1h) {
    h1Details.push({ trader, change });
  }
  for (const [trader, change] of traderChanges1d) {
    d1Details.push({ trader, change });
  }
  for (const [trader, change] of traderChanges1w) {
    w1Details.push({ trader, change });
  }

  // Sort by absolute change
  h1Details.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  d1Details.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  w1Details.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

  return {
    h1: Math.round(h1 * 100) / 100,
    d1: Math.round(d1 * 100) / 100,
    w1: Math.round(w1 * 100) / 100,
    h1Details, d1Details, w1Details
  };
}

/**
 * Build tooltip HTML for change details
 */
function buildChangeTooltip(details) {
  if (!details || details.length === 0) return '';

  const lines = details.slice(0, 5).map(d => {
    const sign = d.change >= 0 ? '+' : '';
    const cls = d.change >= 0 ? 'positive' : 'negative';
    return `<span class="${cls}">${d.trader}: ${sign}${formatUSD(d.change)}</span>`;
  });

  if (details.length > 5) {
    lines.push(`<span class="muted">+${details.length - 5} more...</span>`);
  }

  const total = details.reduce((sum, d) => sum + d.change, 0);
  const totalSign = total >= 0 ? '+' : '';
  const totalCls = total >= 0 ? 'positive' : 'negative';
  lines.push(`<hr><span class="${totalCls}"><strong>Total: ${totalSign}${formatUSD(total)}</strong></span>`);

  return lines.join('<br>');
}

/**
 * Find model portfolio position info
 */
function findModelPosition(conditionId, outcomeIndex) {
  if (!aggregatedPortfolio?.positions) return null;

  return aggregatedPortfolio.positions.find(p =>
    p.conditionId === conditionId &&
    (p.outcomeIndex === outcomeIndex ||
     (p.outcome === 'Yes' && outcomeIndex === 1) ||
     (p.outcome === 'No' && outcomeIndex === 0))
  );
}

/**
 * Run the checker for an address
 */
async function runChecker(address) {
  const resultsDiv = document.getElementById('checker-results');
  const tbody = document.getElementById('checker-tbody');

  if (!address || !address.startsWith('0x') || address.length !== 42) {
    tbody.innerHTML = '<tr><td colspan="9" class="loading">Please enter a valid Ethereum address (0x...)</td></tr>';
    return;
  }

  tbody.innerHTML = '<tr><td colspan="9" class="loading">Loading portfolio data...</td></tr>';
  resultsDiv.style.display = 'block';

  try {
    // Fetch all data in parallel
    const [positions, portfolioValue, usdcBalance, pnl] = await Promise.all([
      fetchCheckerPositions(address),
      fetchCheckerValue(address),
      fetchUsdcBalance(address),
      fetchCheckerPnL(address)
    ]);

    // Calculate total exposure from positions
    let totalExposure = 0;
    for (const pos of positions) {
      totalExposure += Math.abs(parseFloat(pos.currentValue || 0));
    }

    // Total capital = exposure + USDC
    const totalCapital = totalExposure + usdcBalance;

    // Calculate model portfolio total exposure
    const modelTotalExposure = aggregatedPortfolio?.summary?.totalExposure || 0;

    // Portfolio size = exposure + USDC balance
    const portfolioSize = totalExposure + usdcBalance;

    // Update summary cards
    document.getElementById('checker-portfolio-size').textContent = formatUSD(portfolioSize);
    document.getElementById('checker-exposure').textContent = formatUSD(totalExposure);
    document.getElementById('checker-usdc').textContent = formatUSD(usdcBalance);

    const pnlEl = document.getElementById('checker-pnl');
    if (pnl !== null) {
      pnlEl.textContent = (pnl >= 0 ? '+' : '') + formatUSD(pnl);
      pnlEl.className = 'card-value ' + (pnl >= 0 ? 'positive' : 'negative');
    } else {
      pnlEl.textContent = 'N/A';
      pnlEl.className = 'card-value';
    }

    if (positions.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="loading">No positions found for this address</td></tr>';
      return;
    }

    // Build positions table
    const rows = positions.map(pos => {
      const exposure = Math.abs(parseFloat(pos.currentValue || 0));
      const userPct = totalCapital > 0 ? (exposure / totalCapital) * 100 : 0;

      // Find matching model position
      const outcomeIndex = pos.outcomeIndex !== undefined ? pos.outcomeIndex : (pos.outcome === 'Yes' ? 1 : 0);
      const modelPos = findModelPosition(pos.conditionId, outcomeIndex);
      const modelPct = modelPos && modelTotalExposure > 0
        ? (modelPos.totalExposure / modelTotalExposure) * 100
        : 0;

      // Trader count
      const traderCount = modelPos?.traderCount || 0;
      const traderChange = modelPos?.traderCountChange || 0;
      let traderHtml = `${traderCount}`;
      if (traderChange !== 0) {
        const cls = traderChange > 0 ? 'positive' : 'negative';
        const sign = traderChange > 0 ? '+' : '';
        traderHtml += ` <span class="${cls}">(${sign}${traderChange})</span>`;
      }

      // Time-based changes
      const changes = calculatePositionChanges(pos.conditionId, outcomeIndex);

      const h1Class = changes.h1 >= 0 ? 'positive' : 'negative';
      const d1Class = changes.d1 >= 0 ? 'positive' : 'negative';
      const w1Class = changes.w1 >= 0 ? 'positive' : 'negative';

      const h1Sign = changes.h1 >= 0 ? '+' : '';
      const d1Sign = changes.d1 >= 0 ? '+' : '';
      const w1Sign = changes.w1 >= 0 ? '+' : '';

      const marketUrl = pos.eventSlug
        ? polymarketUrl('/event/' + pos.eventSlug)
        : polymarketUrl('/market/' + pos.slug);

      const outcomeClass = pos.outcome === 'Yes' ? 'outcome-yes' : 'outcome-no';

      return `
        <tr>
          <td>
            <a href="${marketUrl}" target="_blank" class="market-link">${pos.title || 'Unknown Market'}</a>
          </td>
          <td><span class="${outcomeClass}">${pos.outcome || '-'}</span></td>
          <td>${formatUSD(exposure)}</td>
          <td>${userPct.toFixed(2)}%</td>
          <td>${modelPct > 0 ? modelPct.toFixed(2) + '%' : '-'}</td>
          <td>${traderCount > 0 ? traderHtml : '-'}</td>
          <td class="tooltip ${h1Class}">
            ${h1Sign}${formatUSD(changes.h1)}
            ${changes.h1Details.length > 0 ? `<span class="tooltip-text">${buildChangeTooltip(changes.h1Details)}</span>` : ''}
          </td>
          <td class="tooltip ${d1Class}">
            ${d1Sign}${formatUSD(changes.d1)}
            ${changes.d1Details.length > 0 ? `<span class="tooltip-text">${buildChangeTooltip(changes.d1Details)}</span>` : ''}
          </td>
          <td class="tooltip ${w1Class}">
            ${w1Sign}${formatUSD(changes.w1)}
            ${changes.w1Details.length > 0 ? `<span class="tooltip-text">${buildChangeTooltip(changes.w1Details)}</span>` : ''}
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = rows.join('');

  } catch (error) {
    console.error('Checker error:', error);
    tbody.innerHTML = `<tr><td colspan="9" class="loading">Error: ${error.message}</td></tr>`;
  }
}

/**
 * Initialize checker section
 */
function initChecker() {
  const btn = document.getElementById('checker-btn');
  const input = document.getElementById('checker-address');

  btn?.addEventListener('click', () => {
    const address = input.value.trim();
    runChecker(address);
  });

  input?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const address = input.value.trim();
      runChecker(address);
    }
  });
}

// Start
document.addEventListener('DOMContentLoaded', init);
