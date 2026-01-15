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
    tbody.innerHTML = '<tr><td colspan="7" class="loading">Loading...</td></tr>';
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
    tbody.innerHTML = '<tr><td colspan="7" class="loading">No traders found</td></tr>';
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
      case 'change24h':
        aVal = a.change24h || 0;
        bVal = b.change24h || 0;
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
    tbody.innerHTML = '<tr><td colspan="6" class="loading">Loading...</td></tr>';
    return;
  }

  // Update header with sort indicators
  if (thead) {
    thead.innerHTML = `
      <tr>
        <th class="sortable" onclick="handlePortfolioSort('title')">Market${getSortIndicator('title')}</th>
        <th>Side</th>
        <th>Avg Entry</th>
        <th class="sortable" onclick="handlePortfolioSort('traderCount')">Traders${getSortIndicator('traderCount')}</th>
        <th class="sortable" onclick="handlePortfolioSort('totalExposure')">Exposure${getSortIndicator('totalExposure')}</th>
        <th class="sortable" onclick="handlePortfolioSort('change24h')">24h Change${getSortIndicator('change24h')}</th>
      </tr>
    `;
  }

  const positions = sortPositions(aggregatedPortfolio.positions);
  if (positions.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="loading">No positions found</td></tr>';
    return;
  }

  tbody.innerHTML = positions.map(pos => {
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

    // 24h change with tooltip
    const change24h = pos.change24h || 0;
    const change24hClass = change24h >= 0 ? 'positive' : 'negative';
    const tooltipContent = build24hTooltip(pos);

    return `
      <tr>
        <td>
          <div class="market-cell">
            ${pos.icon ? `<img src="${pos.icon}" class="market-icon" alt="">` : '<div class="market-icon"></div>'}
            <a href="${marketUrl}" target="_blank" class="market-link">${pos.title || 'Unknown Market'}</a>
          </div>
        </td>
        <td><span class="${outcomeClass}">${pos.outcome || '-'}</span></td>
        <td>${entryHtml}</td>
        <td>${pos.traderCount}</td>
        <td>${formatUSD(pos.totalExposure)}</td>
        <td class="tooltip ${change24hClass}">
          ${change24h >= 0 ? '+' : ''}${formatUSD(change24h)}
          ${tooltipContent ? `<span class="tooltip-text">${tooltipContent}</span>` : ''}
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
 * Render changes table
 */
function renderChangesTable(deltaFilter = 0, timeFilter = 'all') {
  const tbody = document.getElementById('changes-tbody');
  if (!recentChanges?.changes) {
    tbody.innerHTML = '<tr><td colspan="7" class="loading">Loading...</td></tr>';
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
    tbody.innerHTML = '<tr><td colspan="7" class="loading">No changes match filters</td></tr>';
    return;
  }

  tbody.innerHTML = changes.map(c => {
    const marketUrl = c.eventSlug
      ? polymarketUrl('/event/' + c.eventSlug)
      : polymarketUrl('/market/' + c.marketSlug);

    const actionClass = c.action === 'increased' ? 'action-increased' : 'action-decreased';
    const outcomeClass = c.outcome === 'Yes' ? 'outcome-yes' : 'outcome-no';

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
        <td class="${actionClass}">${c.action}</td>
        <td class="${c.delta >= 0 ? 'positive' : 'negative'}">${c.delta >= 0 ? '+' : ''}${formatUSD(c.delta)}</td>
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
  loadData();
}

// Start
document.addEventListener('DOMContentLoaded', init);
