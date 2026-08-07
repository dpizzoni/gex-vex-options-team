const fs = require('fs');
const path = require('path');

// Two different CFTC Socrata reports, both public JSON, no auth/scraping.
// Published Fridays (data as of the prior Tuesday), but safe to run daily
// since it dedupes by report date: a run on a non-Friday with nothing new
// published simply adds 0 rows.
// - TFF ("Traders in Financial Futures"): equity indices, VIX, currencies,
//   rates - has Asset Manager and Leveraged Funds categories.
// - Disaggregated Futures-Only: physical commodities (gold included) - TFF
//   doesn't cover these at all. No "Asset Manager" category exists here;
//   the closest analog to institutional/hedging money is Producer/Merchant
//   + Swap Dealers combined ("Commercials" in standard gold-COT commentary,
//   mostly bullion banks and miners hedging, not asset managers). Managed
//   Money is the direct equivalent of Leveraged Funds (hedge funds/CTAs).
const CFTC_ENDPOINTS = {
  tff: 'https://publicreporting.cftc.gov/resource/gpe5-46if.json',
  disaggregated: 'https://publicreporting.cftc.gov/resource/72hh-3qpy.json'
};

// Verified against the live dataset (open_interest_all + most recent
// report_date_as_yyyy_mm_dd): CME reports ES/NQ under several similarly
// named lines (plain E-mini, Micro E-mini, legacy names that stopped getting
// new reports years ago). The "Consolidated" line is the one CME/CFTC
// currently keeps up to date and folds E-mini + Micro E-mini together -
// picking anything else (e.g. "NASDAQ-100 STOCK INDEX (MINI)") silently
// returns stale pre-2022 rows instead of erroring.
const INSTRUMENTS = {
  ES: { report: 'tff', marketName: 'S&P 500 Consolidated - CHICAGO MERCANTILE EXCHANGE' },
  NQ: { report: 'tff', marketName: 'NASDAQ-100 Consolidated - CHICAGO MERCANTILE EXCHANGE' },
  VX: { report: 'tff', marketName: 'VIX FUTURES - CBOE FUTURES EXCHANGE' },
  GC: { report: 'disaggregated', marketName: 'GOLD - COMMODITY EXCHANGE INC.' }
};

// Both categories are cheap to keep from the same row: Asset Manager/
// Institutional is the closer match to "fondos de inversión" (traditional
// institutional money), Leveraged Funds is the closer match to "grandes
// especuladores y fondos de cobertura" from the original research - no
// reason to pick just one.
function toEntryTFF(instrument, row) {
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

// Same output shape as toEntryTFF (asset_mgr_net/lev_money_net field names
// kept for schema consistency with downstream consumers) but sourced from
// the Disaggregated report's different columns - see CFTC_ENDPOINTS comment
// above for what each field actually represents for a commodity like gold.
function toEntryDisaggregated(instrument, row) {
  const commercialLong = parseInt(row.prod_merc_positions_long, 10) + parseInt(row.swap_positions_long_all, 10);
  const commercialShort = parseInt(row.prod_merc_positions_short, 10) + parseInt(row.swap__positions_short_all, 10);
  const commercialLongChange = parseInt(row.change_in_prod_merc_long, 10) + parseInt(row.change_in_swap_long_all, 10);
  const commercialShortChange = parseInt(row.change_in_prod_merc_short, 10) + parseInt(row.change_in_swap_short_all, 10);
  return {
    date: row.report_date_as_yyyy_mm_dd.slice(0, 10),
    instrument,
    open_interest: parseInt(row.open_interest_all, 10),
    asset_mgr_net: commercialLong - commercialShort,
    asset_mgr_net_change: commercialLongChange - commercialShortChange,
    lev_money_net: parseInt(row.m_money_positions_long_all, 10) - parseInt(row.m_money_positions_short_all, 10),
    lev_money_net_change: parseInt(row.change_in_m_money_long_all, 10) - parseInt(row.change_in_m_money_short_all, 10)
  };
}

function toEntry(instrument, report, row) {
  return report === 'disaggregated' ? toEntryDisaggregated(instrument, row) : toEntryTFF(instrument, row);
}

async function fetchLatest(report, marketName, weeks = 52) {
  const where = encodeURIComponent(`market_and_exchange_names = '${marketName.replace(/'/g, "''")}'`);
  const url = `${CFTC_ENDPOINTS[report]}?$where=${where}&$order=report_date_as_yyyy_mm_dd DESC&$limit=${weeks}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CFTC API HTTP ${res.status} for ${marketName}`);
  return res.json();
}

const cacheFilePath = path.join(__dirname, '..', 'cache', 'cot-positioning.json');

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

  for (const [instrument, { report, marketName }] of Object.entries(INSTRUMENTS)) {
    try {
      const rows = await fetchLatest(report, marketName);
      for (const row of rows) {
        const entry = toEntry(instrument, report, row);
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
