/**
 * Scrape Polymarket profile page to get accurate PnL data
 */

/**
 * Fetch profile page and extract PnL data
 * @param {string} addressOrUsername - Wallet address or username
 * @returns {Promise<{amount: number, pnl: number}|null>}
 */
export async function scrapeProfilePnL(addressOrUsername) {
  // Try username first (if it looks like a username), otherwise use address
  const isAddress = addressOrUsername.startsWith('0x');
  const url = isAddress
    ? `https://polymarket.com/profile/${addressOrUsername}`
    : `https://polymarket.com/@${addressOrUsername}`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml'
      }
    });

    if (!response.ok) {
      console.warn(`Failed to fetch profile: ${response.status}`);
      return null;
    }

    const html = await response.text();

    // Extract __NEXT_DATA__ JSON
    const match = html.match(/__NEXT_DATA__[^>]*>({.*?})<\/script>/);
    if (!match) {
      console.warn('Could not find __NEXT_DATA__ in page');
      return null;
    }

    const data = JSON.parse(match[1]);
    const queries = data.props?.pageProps?.dehydratedState?.queries || [];

    // Find the volume query which contains PnL
    for (const q of queries) {
      const d = q.state?.data;
      if (d && typeof d.pnl === 'number' && typeof d.amount === 'number') {
        return {
          amount: d.amount,      // Trading volume
          pnl: d.pnl,            // Profit/Loss
          realized: d.realized || 0,
          unrealized: d.unrealized || 0
        };
      }
    }

    console.warn('Could not find PnL data in page queries');
    return null;
  } catch (error) {
    console.warn(`Error scraping profile: ${error.message}`);
    return null;
  }
}

/**
 * Batch scrape multiple profiles with rate limiting
 * @param {Array<{address: string, label: string}>} traders
 * @param {number} delayMs - Delay between requests
 * @returns {Promise<Map<string, {pnl: number, amount: number}>>}
 */
export async function batchScrapeProfiles(traders, delayMs = 1000) {
  const results = new Map();

  for (const trader of traders) {
    // Try username first if available, otherwise use address
    const identifier = trader.label || trader.address;
    console.log(`Scraping profile for ${identifier}...`);

    const data = await scrapeProfilePnL(identifier);

    if (data) {
      results.set(trader.address.toLowerCase(), data);
    } else {
      // Fallback: try with address if username failed
      if (identifier !== trader.address) {
        const dataByAddr = await scrapeProfilePnL(trader.address);
        if (dataByAddr) {
          results.set(trader.address.toLowerCase(), dataByAddr);
        }
      }
    }

    // Rate limit
    await new Promise(r => setTimeout(r, delayMs));
  }

  return results;
}

export default {
  scrapeProfilePnL,
  batchScrapeProfiles
};
