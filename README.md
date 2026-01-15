# Tier1 Traders Watch

A static dashboard for tracking top Polymarket traders' portfolios and trades. Hosted on GitHub Pages with automated data updates via GitHub Actions.

## Features

- **Traders List**: View all tracked traders with portfolio values and position counts
- **Aggregated Portfolio**: See combined holdings across all traders, sorted by exposure
- **Recent Changes**: Track position changes with filtering by delta size and time window
- **Auto-refresh**: Data updates every 10 minutes via GitHub Actions

## Setup

### 1. Add Traders

Edit `data/tier1_traders.csv` to add trader wallet addresses:

```csv
address,label,tier,notes,source_url
0x1234...abcd,WhaleTrader,1,Top performer,https://polymarket.com/profile/0x1234...
0x5678...efgh,SharpBettor,1,Consistent returns,https://polymarket.com/profile/0x5678...
```

### 2. Configure (Optional)

Edit `config.json` to customize settings:

```json
{
  "poll_interval_seconds": 300,
  "max_recent_events": 200,
  "min_usd_filter": 50,
  "concurrency_limit": 5,
  "retry_attempts": 3,
  "retry_base_delay_ms": 1000
}
```

### 3. Run Locally

```bash
# Fetch data
node scripts/fetch_data.js

# Open dashboard in browser
# Open docs/index.html
```

### 4. Deploy to GitHub Pages

1. Push the repository to GitHub
2. Go to Settings > Pages
3. Select "Deploy from a branch"
4. Choose `main` branch and `/docs` folder
5. Save

The GitHub Action will automatically:
- Run every 10 minutes
- Fetch latest Polymarket data
- Update JSON files in `docs/data/`
- Commit and push changes

## Project Structure

```
tier1-traders-watch/
├── data/
│   └── tier1_traders.csv      # Trader addresses (edit this!)
├── docs/                       # GitHub Pages root
│   ├── index.html             # Dashboard
│   ├── assets/
│   │   ├── style.css
│   │   └── app.js
│   └── data/                   # Auto-generated JSON
│       ├── metadata.json
│       ├── aggregated_portfolio.json
│       ├── trader_portfolios.json
│       └── recent_changes.json
├── scripts/
│   ├── fetch_data.js          # Main script
│   ├── polymarket_api.js      # API wrapper
│   └── compute_aggregates.js  # Data processing
├── .github/workflows/
│   └── update-data.yml        # Scheduled workflow
├── config.json                 # Configuration
└── README.md
```

## Data Sources

Uses Polymarket's public Data API:
- `GET /positions` - Current wallet positions
- `GET /activity` - Trade history
- `GET /value` - Portfolio value

No API key required.

## Dashboard Sections

### Traders List
- Trader name/label with profile link
- Portfolio value
- Number of open positions
- Fetch status indicator
- Copy address button

### Aggregated Portfolio
- **Summary Cards**: Total exposure, distinct markets, concentration metrics, 24h flow
- **Positions Table**: Market, outcome side, trader count, total exposure, avg hold time, 24h change

### Recent Changes
- Chronological feed of position changes
- **Filters**: Delta threshold ($1K, $10K), time window (1h, 6h, 24h, 7d)
- **Flow Summaries**: Net flow for 1h, 6h, 24h, 7d, 30d windows
- Color-coded deltas (green positive, red negative)

## Troubleshooting

### Data not loading
- Run `node scripts/fetch_data.js` to generate initial data
- Check browser console for errors
- Verify JSON files exist in `docs/data/`

### GitHub Actions not running
- Check Actions tab for workflow status
- Verify workflow file is in `.github/workflows/`
- Check repository has Actions enabled

### Rate limiting
- The script includes retry logic with exponential backoff
- Reduce `concurrency_limit` in config if needed
- Default limit handles 20-200 traders well

## License

MIT
