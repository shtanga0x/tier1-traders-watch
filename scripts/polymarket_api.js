/**
 * Polymarket API wrapper with retry logic and rate limiting
 */

const DATA_API_BASE = 'https://data-api.polymarket.com';
const POLYGON_RPC = 'https://polygon-rpc.com';

// USDC contracts on Polygon
const USDC_NATIVE = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'; // Native USDC
const USDC_BRIDGED = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'; // USDC.e

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch with retry and exponential backoff
 */
async function fetchWithRetry(url, options = {}, config = {}) {
  const maxRetries = config.retry_attempts || 3;
  const baseDelay = config.retry_base_delay_ms || 1000;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Accept': 'application/json',
          ...options.headers
        }
      });

      if (response.status === 429) {
        // Rate limited - wait and retry
        const delay = baseDelay * Math.pow(2, attempt);
        console.warn(`Rate limited, waiting ${delay}ms before retry...`);
        await sleep(delay);
        continue;
      }

      if (response.status >= 500) {
        // Server error - retry
        const delay = baseDelay * Math.pow(2, attempt);
        console.warn(`Server error ${response.status}, waiting ${delay}ms before retry...`);
        await sleep(delay);
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      if (attempt === maxRetries - 1) {
        throw error;
      }
      const delay = baseDelay * Math.pow(2, attempt);
      console.warn(`Request failed: ${error.message}, retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }
}

/**
 * Fetch current positions for a wallet
 * @param {string} address - Wallet address (0x...)
 * @param {number} limit - Max results (default 1000)
 * @param {object} config - Config object
 * @returns {Promise<Array>} Array of position objects
 */
export async function fetchWalletPositions(address, limit = 1000, config = {}) {
  const url = `${DATA_API_BASE}/positions?user=${address.toLowerCase()}&limit=${limit}`;
  const data = await fetchWithRetry(url, {}, config);
  return data || [];
}

/**
 * Fetch wallet activity/trades
 * @param {string} address - Wallet address
 * @param {number} since - Unix timestamp to fetch activity since (optional)
 * @param {number} limit - Max results per page
 * @param {object} config - Config object
 * @returns {Promise<Array>} Array of activity objects
 */
export async function fetchWalletActivity(address, since = null, limit = 100, config = {}) {
  let url = `${DATA_API_BASE}/activity?user=${address.toLowerCase()}&limit=${limit}`;
  if (since) {
    url += `&start=${since}`;
  }
  const data = await fetchWithRetry(url, {}, config);
  return data || [];
}

/**
 * Fetch total portfolio value for a wallet
 * @param {string} address - Wallet address
 * @param {object} config - Config object
 * @returns {Promise<number>} Total value in USD
 */
export async function fetchWalletValue(address, config = {}) {
  const url = `${DATA_API_BASE}/value?user=${address.toLowerCase()}`;
  const data = await fetchWithRetry(url, {}, config);
  if (!data || data.length === 0) {
    return 0;
  }
  try {
    return parseFloat(data[0]?.value || 0);
  } catch {
    return 0;
  }
}

/**
 * Fetch trades for a wallet
 * @param {string} address - Wallet address
 * @param {number} limit - Max results
 * @param {object} config - Config object
 * @returns {Promise<Array>} Array of trade objects
 */
export async function fetchWalletTrades(address, limit = 500, config = {}) {
  const url = `${DATA_API_BASE}/trades?user=${address.toLowerCase()}&limit=${limit}`;
  const data = await fetchWithRetry(url, {}, config);
  return data || [];
}

/**
 * Fetch USDC balance from Polygon blockchain
 * @param {string} address - Wallet address
 * @param {object} config - Config object
 * @returns {Promise<number>} USDC balance in USD
 */
export async function fetchUsdcBalance(address, config = {}) {
  const addr = address.toLowerCase().replace('0x', '');
  // balanceOf(address) function selector = 0x70a08231
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
        // USDC has 6 decimals
        return parseInt(result.result, 16) / 1e6;
      }
      return 0;
    } catch (error) {
      console.warn(`Failed to fetch USDC balance from ${tokenContract}: ${error.message}`);
      return 0;
    }
  }

  // Fetch both native USDC and bridged USDC.e
  const [nativeBalance, bridgedBalance] = await Promise.all([
    getBalance(USDC_NATIVE),
    getBalance(USDC_BRIDGED)
  ]);

  return Math.round((nativeBalance + bridgedBalance) * 100) / 100;
}

/**
 * Batch fetch with concurrency limit
 * @param {Array<string>} addresses - Array of wallet addresses
 * @param {Function} fetchFn - Function to call for each address
 * @param {number} concurrency - Max concurrent requests
 * @param {object} config - Config object
 * @returns {Promise<Map>} Map of address -> result
 */
export async function batchFetch(addresses, fetchFn, concurrency = 5, config = {}) {
  const results = new Map();
  const queue = [...addresses];
  const inFlight = new Set();

  async function processNext() {
    if (queue.length === 0) return;

    const address = queue.shift();
    inFlight.add(address);

    try {
      const result = await fetchFn(address, config);
      results.set(address, { success: true, data: result });
    } catch (error) {
      console.error(`Failed to fetch for ${address}: ${error.message}`);
      results.set(address, { success: false, error: error.message });
    } finally {
      inFlight.delete(address);
    }
  }

  // Process in batches
  while (queue.length > 0 || inFlight.size > 0) {
    while (inFlight.size < concurrency && queue.length > 0) {
      processNext();
    }
    if (inFlight.size > 0) {
      await sleep(100); // Small delay between batch checks
    }
  }

  return results;
}

/**
 * Fetch profit leaderboard (contains all-time PnL)
 * @param {number} limit - Max results (default 5000)
 * @param {object} config - Config object
 * @returns {Promise<Map>} Map of address -> profit amount
 */
export async function fetchProfitLeaderboard(limit = 5000, config = {}) {
  const url = `https://lb-api.polymarket.com/profit?window=all&limit=${limit}`;
  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) {
      console.warn(`Failed to fetch leaderboard: ${response.status}`);
      return new Map();
    }
    const data = await response.json();
    const profitMap = new Map();
    for (const user of data) {
      profitMap.set(user.proxyWallet.toLowerCase(), user.amount);
    }
    return profitMap;
  } catch (error) {
    console.warn(`Failed to fetch leaderboard: ${error.message}`);
    return new Map();
  }
}

export default {
  fetchWalletPositions,
  fetchWalletActivity,
  fetchWalletValue,
  fetchWalletTrades,
  fetchUsdcBalance,
  fetchProfitLeaderboard,
  batchFetch
};
