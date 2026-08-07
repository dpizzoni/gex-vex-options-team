require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Same FRED API as fetch-fed-liquidity.js, different series: the risk/credit
// side of the Institutional Flow Score instead of the liquidity side.
const FRED_API_KEY = process.env.FRED_API_KEY?.trim();
const FRED_ENDPOINT = 'https://api.stlouisfed.org/fred/series/observations';

const SERIES = {
  vix: 'VIXCLS',        // CBOE Volatility Index, daily
  hyOas: 'BAMLH0A0HYM2', // ICE BofA US High Yield OAS credit spread, daily
  igOas: 'BAMLC0A0CM',   // ICE BofA US Investment Grade (Corporate Master) OAS, daily
  us10y: 'DGS10',        // 10-Year Treasury Constant Maturity Rate, daily
  dxy: 'DTWEXBGS',       // Fed's Nominal Broad U.S. Dollar Index (DXY proxy - no
                         // license-restricted ICE DXY series is free on FRED), daily
  real10y: 'DFII10'      // 10-Year Treasury Inflation-Indexed (real) yield, daily -
                          // the opportunity-cost driver behind gold moves that
                          // us10y (nominal) alone can't isolate.
};

const cacheFilePath = path.join(__dirname, '..', 'cache', 'market-risk.json');

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

// All series are daily but each has its own holiday/publish gaps, so merge
// on the union of dates and forward-fill - same approach as
// fetch-fed-liquidity.js's mixed-frequency merge.
function mergeSeries(vix, hyOas, igOas, us10y, dxy, real10y) {
  const maps = {
    vix: new Map(vix.map(o => [o.date, o.value])),
    hyOas: new Map(hyOas.map(o => [o.date, o.value])),
    igOas: new Map(igOas.map(o => [o.date, o.value])),
    us10y: new Map(us10y.map(o => [o.date, o.value])),
    dxy: new Map(dxy.map(o => [o.date, o.value])),
    real10y: new Map(real10y.map(o => [o.date, o.value]))
  };
  const allDates = Array.from(new Set([
    ...vix.map(o => o.date),
    ...hyOas.map(o => o.date),
    ...igOas.map(o => o.date),
    ...us10y.map(o => o.date),
    ...dxy.map(o => o.date),
    ...real10y.map(o => o.date)
  ])).sort();

  const last = { vix: null, hyOas: null, igOas: null, us10y: null, dxy: null, real10y: null };
  const merged = [];
  for (const date of allDates) {
    for (const key of Object.keys(maps)) {
      if (maps[key].has(date)) last[key] = maps[key].get(date);
    }
    if (last.vix === null || last.hyOas === null || last.igOas === null || last.us10y === null || last.dxy === null || last.real10y === null) continue;
    merged.push({ date, vix: last.vix, hy_oas: last.hyOas, ig_oas: last.igOas, us10y: last.us10y, dxy: last.dxy, real_yield_10y: last.real10y });
  }
  return merged;
}

async function run() {
  if (!FRED_API_KEY) {
    console.error('FRED_API_KEY missing from .env');
    process.exit(1);
  }

  const existing = loadHistory();
  const startDate = existing.length > 0
    ? existing[Math.max(0, existing.length - 30)].date
    : '2024-06-01';

  try {
    const [vix, hyOas, igOas, us10y, dxy, real10y] = await Promise.all([
      fetchSeries(SERIES.vix, startDate),
      fetchSeries(SERIES.hyOas, startDate),
      fetchSeries(SERIES.igOas, startDate),
      fetchSeries(SERIES.us10y, startDate),
      fetchSeries(SERIES.dxy, startDate),
      fetchSeries(SERIES.real10y, startDate)
    ]);

    const freshMerged = mergeSeries(vix, hyOas, igOas, us10y, dxy, real10y);
    const byDate = new Map(existing.map(e => [e.date, e]));
    for (const entry of freshMerged) byDate.set(entry.date, entry);

    const merged = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
    fs.writeFileSync(cacheFilePath, JSON.stringify(merged, null, 2), 'utf8');
    console.log(`Market risk cache updated: ${merged.length} total rows, latest ${merged[merged.length - 1]?.date}`);
  } catch (err) {
    console.error('Failed to fetch market risk data:', err.message);
    process.exit(1);
  }
}

run();
