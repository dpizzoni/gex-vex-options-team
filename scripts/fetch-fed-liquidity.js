require('dotenv').config();
const fs = require('fs');
const path = require('path');

// FRED (Federal Reserve Economic Data) public API - free, one request/series.
// Docs: https://fred.stlouisfed.org/docs/api/fred/series_observations.html
const FRED_API_KEY = process.env.FRED_API_KEY?.trim();
const FRED_ENDPOINT = 'https://api.stlouisfed.org/fred/series/observations';

// WALCL: Fed total assets (weekly, Wed). RRPONTSYD: overnight reverse repo
// (daily). WTREGEN: Treasury General Account balance (weekly, Wed) - the
// only TGA series FRED publishes without a Treasury.gov scrape.
const SERIES = {
  walcl: 'WALCL',
  rrp: 'RRPONTSYD',
  tga: 'WTREGEN'
};

const cacheFilePath = path.join(__dirname, '..', 'cache', 'fed-liquidity.json');

async function fetchSeries(seriesId, startDate) {
  const url = `${FRED_ENDPOINT}?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json&observation_start=${startDate}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FRED API HTTP ${res.status} for ${seriesId}`);
  const body = await res.json();
  return body.observations
    .filter(o => o.value !== '.')
    .map(o => ({ date: o.date, value: parseFloat(o.value) }));
}

function loadHistory() {
  if (!fs.existsSync(cacheFilePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(cacheFilePath, 'utf8'));
  } catch (e) {
    return [];
  }
}

// WALCL/TGA are weekly (Wed) and RRP is daily, so each raw series has its own
// native dates. Forward-fill WALCL/TGA onto every date RRP reports, so each
// merged row always has all three values (last-known-value carry-forward is
// standard practice for mixed-frequency Fed series like this).
function mergeSeries(walcl, rrp, tga) {
  const walclByDate = new Map(walcl.map(o => [o.date, o.value]));
  const tgaByDate = new Map(tga.map(o => [o.date, o.value]));

  const allDates = Array.from(new Set([
    ...walcl.map(o => o.date),
    ...rrp.map(o => o.date),
    ...tga.map(o => o.date)
  ])).sort();

  let lastWalcl = null;
  let lastTga = null;
  const merged = [];
  const rrpByDate = new Map(rrp.map(o => [o.date, o.value]));

  for (const date of allDates) {
    if (walclByDate.has(date)) lastWalcl = walclByDate.get(date);
    if (tgaByDate.has(date)) lastTga = tgaByDate.get(date);
    const rrpValue = rrpByDate.has(date) ? rrpByDate.get(date) : null;

    if (lastWalcl === null || lastTga === null || rrpValue === null) continue;

    // FRED reports WALCL/TGA in $ millions, RRP in $ billions - normalize
    // everything to $ billions before computing net liquidity.
    const walclB = lastWalcl / 1000;
    const tgaB = lastTga / 1000;
    const rrpB = rrpValue;
    merged.push({
      date,
      walcl: walclB,
      tga: tgaB,
      rrp: rrpB,
      net_liquidity: walclB - tgaB - rrpB
    });
  }
  return merged;
}

async function run() {
  if (!FRED_API_KEY) {
    console.error('FRED_API_KEY missing from .env - get a free key at https://fred.stlouisfed.org/docs/api/api_key.html');
    process.exit(1);
  }

  const existing = loadHistory();
  // 400 days back is enough to seed a first run with over a year of history
  // (WALCL/TGA are weekly, so that's ~55 points) without re-pulling FRED's
  // entire multi-decade backfill every day.
  const startDate = existing.length > 0
    ? existing[Math.max(0, existing.length - 60)].date
    : '2024-06-01';

  try {
    const [walcl, rrp, tga] = await Promise.all([
      fetchSeries(SERIES.walcl, startDate),
      fetchSeries(SERIES.rrp, startDate),
      fetchSeries(SERIES.tga, startDate)
    ]);

    const freshMerged = mergeSeries(walcl, rrp, tga);
    const byDate = new Map(existing.map(e => [e.date, e]));
    for (const entry of freshMerged) byDate.set(entry.date, entry);

    const merged = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
    fs.writeFileSync(cacheFilePath, JSON.stringify(merged, null, 2), 'utf8');
    console.log(`Fed liquidity cache updated: ${merged.length} total rows, latest ${merged[merged.length - 1]?.date}`);
  } catch (err) {
    console.error('Failed to fetch Fed liquidity data:', err.message);
    process.exit(1);
  }
}

run();
