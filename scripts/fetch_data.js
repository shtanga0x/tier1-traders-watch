#!/usr/bin/env node
/**
 * Main entry point for fetching Polymarket data and generating JSON files
 *
 * Usage:
 *   node scripts/fetch_data.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { computeAll } from './compute_aggregates.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'docs', 'data');

/**
 * Ensure directory exists
 */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Write JSON file with pretty formatting
 */
function writeJSON(filepath, data) {
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`Wrote: ${filepath}`);
}

/**
 * Main function
 */
async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Tier1 Traders Watch - Data Refresh');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`Started at: ${new Date().toISOString()}\n`);

  try {
    // Ensure output directory exists
    ensureDir(DATA_DIR);

    // Compute all data
    const {
      metadata,
      aggregatedPortfolio,
      traderPortfolios,
      recentChanges
    } = await computeAll();

    // Write output files
    writeJSON(path.join(DATA_DIR, 'metadata.json'), metadata);
    writeJSON(path.join(DATA_DIR, 'aggregated_portfolio.json'), aggregatedPortfolio);
    writeJSON(path.join(DATA_DIR, 'trader_portfolios.json'), traderPortfolios);
    writeJSON(path.join(DATA_DIR, 'recent_changes.json'), recentChanges);

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('  Summary');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`  Traders tracked: ${metadata.trader_count}`);
    console.log(`  Traders fetched: ${metadata.traders_fetched}`);
    console.log(`  Markets held: ${metadata.market_count}`);
    console.log(`  Total exposure: $${metadata.total_exposure.toLocaleString()}`);
    console.log(`  Recent activities: ${metadata.activity_count}`);
    console.log(`  Last updated: ${metadata.last_updated}`);
    console.log('═══════════════════════════════════════════════════════\n');

    console.log('Data refresh completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('\nFailed to refresh data:', error);
    process.exit(1);
  }
}

main();
