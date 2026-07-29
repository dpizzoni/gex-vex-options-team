const fs = require('fs');
const path = require('path');

// CFTC's "Traders in Financial Futures" report, public Socrata JSON API - no
// auth, no scraping. Published Fridays (data as of the prior Tuesday), but
// this is safe to run daily since it dedupes by report date: a run on a
// non-Friday with nothing new published simply adds 0 rows.
const CFTC_ENDPOINT = 'https://publicreporting.cftc.gov/resource/gpe5-46if.json';

// Verified against the live dataset (open_interest_all + most recent
// report_date_as_yyyy_mm_dd): CME reports ES/NQ under several similarly
// named lines (plain E-mini, Micro E-mini, legacy names that stopped getting
// new reports years ago). The "Consolidated" line is the one CME/CFTC
// currently keeps up to date and folds E-mini + Micro E-mini together -
// picking anything else (e.g. "NASDAQ-100 STOCK INDEX (MINI)") silently
// returns stale pre-2022 rows instead of erroring.
const INSTRUMENTS = {
  ES: 'S&P 500 Consolidated - CHICAGO MERCANTILE EXCHANGE',
  NQ: 'NASDAQ-100 Consolidated - CHICAGO MERCANTILE EXCHANGE',
  VX: 'VIX FUTURES - CBOE FUTURES EXCHANGE'
};

const cacheFilePath = path.join(__dirname, '..', 'cache', 'cot-positioning.json');

// Both categories are cheap to keep from the same row: Asset Manager/
// Institutional is the closer match to "fondos de inversión" (traditional
// institutional money), Leveraged Funds is the closer match to "grandes
// especuladores y fondos de cobertura" from the original research - no
// reason to pick just one.
function toEntry(instrument, row) {
  return {
    date: row.report_date_as_yyyy_mm_dd.slice(0, 10),
    instrument,
    open_interest: parseInt(row.open_interest_all, 10),
    asset_mgr_net: parseInt(row.asset_mgr_positions_long, 10) - parseInt(row.asset_mgr_positions_short, 10),
    asset_mgr_net_change: parseInt(row.change_in_asset_mgr_long, 10) - parseInt(row.change_in_asset_mgr_short, 10),
    lev_money_net: parseInt(row.lev_money_positions_long, 10) - parseInt(row.lev_money_positions_short, 10),
    lev_money_net_change: parseInt(row.change_in_lev_money_long, 10) - parseInt(row.change_in_lev_money_short, 10)
  };
}

async function fetchLatest(marketName, weeks = 52) {
  const where = encodeURIComponent(`market_and_exchange_names = '${marketName.replace(/'/g, "''")}'`);
  const url = `${CFTC_ENDPOINT}?$where=${where}&$order=report_date_as_yyyy_mm_dd DESC&$limit=${weeks}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CFTC API HTTP ${res.status} for ${marketName}`);
  return res.json();
}

function loadHistory() {
  if (!fs.existsSync(cacheFilePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(cacheFilePath, 'utf8'));
  } catch (e) {
    return [];
  }
}

async function run() {
  const existing = loadHistory();
  const existingKeys = new Set(existing.map(e => `${e.date}_${e.instrument}`));
  const added = [];

  for (const [instrument, marketName] of Object.entries(INSTRUMENTS)) {
    try {
      const rows = await fetchLatest(marketName);
      for (const row of rows) {
        const entry = toEntry(instrument, row);
        const key = `${entry.date}_${entry.instrument}`;
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);
        added.push(entry);
      }
    } catch (err) {
      console.error(`Failed to fetch COT data for ${instrument} (${marketName}):`, err.message);
    }
  }

  if (added.length > 0) {
    const merged = [...existing, ...added].sort((a, b) => (a.date + a.instrument).localeCompare(b.date + b.instrument));
    fs.writeFileSync(cacheFilePath, JSON.stringify(merged, null, 2), 'utf8');
    console.log(`Added ${added.length} new COT report row(s): ${added.map(e => `${e.instrument} ${e.date}`).join(', ')}`);
  } else {
    console.log('No new COT reports since last run.');
  }
}

run();
