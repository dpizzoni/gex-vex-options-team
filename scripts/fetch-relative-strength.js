const fs = require('fs');
const path = require('path');
const YFMod = require('yahoo-finance2');
const YF = YFMod.default || YFMod;

// Ports the "Fuerza Relativa" Google Sheets system (see docs/knowledge/*.md,
// local-only, gitignored) to a standalone module - NOT wired into
// generate-institutional-analysis.js's LLM payload. Runs daily via the
// relative-strength-refresh job in .circleci/config.yml (chained after
// fund-flow-refresh in the daily-close workflow); `npm run rs:daily` also
// works standalone for manual runs.
//
// Universe + Spanish names extracted directly from %RS!D:E in
// docs/knowledge/Fuerza Relativa.xlsx (70 tickers = SPY benchmark + 69
// sector/industry ETFs, re-synced 2026-08-05 after the live sheet grew from
// 60 to 70 rows mid-project - the original 60-ticker extraction predated a
// fresh re-download of the source file) - this is the `%RS`/`Resumen`
// universe only, not the separate "Nuevas Industrias" (55 ETFs) or personal
// stock watchlist, both out of scope for v1. The 10 tickers added in this
// resync (DRNZ, SHLD, SOCL, XHS, XPH, BOAT, MLPX, NLR, RSP, IWM) all read
// score=0 in the live sheet right now (RN-02's IFERROR(...,0) fallback for
// insufficient history) - several are old, liquid ETFs (IWM, RSP, SOCL, XHS,
// XPH, MLPX) that are likely just newly added to the sheet's own BD backfill
// rather than genuinely new to the market, so MIN_ALIGNED_SESSIONS below
// (backed by real Yahoo history, not the sheet's backfill state) decides
// per-ticker whether each one actually has enough history yet.
const UNIVERSE = [
  { ticker: 'SPY', name: 'Índice del mercado' },
  { ticker: 'XLK', name: 'Tecnología' },
  { ticker: 'SMH', name: 'Semiconductores' },
  { ticker: 'XTL', name: 'Equipos de telecom' },
  { ticker: 'IGV', name: 'Software de tecnología' },
  { ticker: 'FDN', name: 'Empresas de internet' },
  { ticker: 'HACK', name: 'Ciberseguridad' },
  { ticker: 'CIBR', name: 'Nasdaq Ciberseguridad' },
  { ticker: 'ROBO', name: 'Robótica y automatización' },
  { ticker: 'BOTZ', name: 'Robótica y Inteligencia Artificial' },
  { ticker: 'QTUM', name: 'Computación cuántica' },
  { ticker: 'BLOK', name: 'Tecnología blockchain' },
  { ticker: 'NASA', name: 'Espacio' },
  { ticker: 'DRNZ', name: 'Drones' },
  { ticker: 'SHLD', name: 'Tecnología militar' },
  { ticker: 'DRAM', name: 'Memorias RAM' },
  { ticker: 'AIQ', name: 'Inteligencia Artificial' },
  { ticker: 'KWEB', name: 'Internet en China' },
  { ticker: 'XLF', name: 'Servicios financieros' },
  { ticker: 'IPAY', name: 'Servicios de pagos' },
  { ticker: 'KRE', name: 'Bancos regionales' },
  { ticker: 'KBE', name: 'Bancos' },
  { ticker: 'KCE', name: 'Capital Markets' },
  { ticker: 'IAI', name: 'Brokers' },
  { ticker: 'KIE', name: 'Seguros' },
  { ticker: 'XLY', name: 'Consumo discrecional' },
  { ticker: 'PEJ', name: 'Ocio y entretenimiento' },
  { ticker: 'XRT', name: 'Comercio minorista' },
  { ticker: 'PBJ', name: 'Comida & Bebida' },
  { ticker: 'XLC', name: 'Servicios de comunicación' },
  { ticker: 'SOCL', name: 'Redes sociales' },
  { ticker: 'IYZ', name: 'Telecomunicaciones' },
  { ticker: 'IXP', name: 'Global servicios de comunicaciones' },
  { ticker: 'XLV', name: 'Sector Salud' },
  { ticker: 'IHI', name: 'Dispositivos médicos' },
  { ticker: 'XHS', name: 'Servicios de salud' },
  { ticker: 'XPH', name: 'Farmacéuticas' },
  { ticker: 'IBB', name: 'Biotecnología' },
  { ticker: 'XBI', name: 'Biotecnología' },
  { ticker: 'XLI', name: 'Sector industrial' },
  { ticker: 'JETS', name: 'Aerolíneas' },
  { ticker: 'BOAT', name: 'Transporte marítimo' },
  { ticker: 'ITA', name: 'Aeroespacial y defensa' },
  { ticker: 'IYT', name: 'Transporte' },
  { ticker: 'IDRV', name: 'Vehículos autónomos y tecnología' },
  { ticker: 'XLP', name: 'Bienes de consumo básicos' },
  { ticker: 'XLE', name: 'Sector energético' },
  { ticker: 'XOP', name: 'Exploración de Oil & Gas' },
  { ticker: 'OIH', name: 'Servicios petroleros' },
  { ticker: 'MLPX', name: 'Infraestructura de energía' },
  { ticker: 'XLU', name: 'Servicios públicos' },
  { ticker: 'TAN', name: 'Energía solar' },
  { ticker: 'PBW', name: 'Energía limpia' },
  { ticker: 'IYR', name: 'Bienes raíces' },
  { ticker: 'ITB', name: 'Construcción de viviendas' },
  { ticker: 'MOO', name: 'Agricultura' },
  { ticker: 'VEGI', name: 'Productores agrícolas' },
  { ticker: 'XLB', name: 'Materiales básicos' },
  { ticker: 'GDX', name: 'Minería de oro' },
  { ticker: 'XME', name: 'Metales y minería' },
  { ticker: 'URA', name: 'Minería de Uranio' },
  { ticker: 'NLR', name: 'Uranio' },
  { ticker: 'REMX', name: 'Tierras raras' },
  { ticker: 'COPX', name: 'Mineros de cobre' },
  { ticker: 'SLX', name: 'Industria del acero' },
  { ticker: 'SIL', name: 'Mineros de plata' },
  { ticker: 'RSP', name: 'S&P 500 Equiponderado' },
  { ticker: 'IWM', name: 'Small Caps' },
  { ticker: 'IWF', name: 'Growth' },
  { ticker: 'IWD', name: 'Value' }
];

const BENCHMARK = 'SPY';
const WINDOW_DAYS = 420; // calendar days kept in the rolling raw-price cache
const MIN_ALIGNED_SESSIONS = 48; // RN-13 analog: floor for score/ranking eligibility
const SCORE_WINDOW = 25; // RN-02: percentile window depth
const DELTA_ANCHOR_OFFSET = 4; // RN-03: "1 week ago" = 4 trading sessions back
const DELTA_1M_WINDOW = 44; // RN-03: documented asymmetric window, replicated as-is

const cacheDir = path.join(__dirname, '..', 'cache');
const pricesPath = path.join(cacheDir, 'relative-strength-prices.json');
const outputPath = path.join(cacheDir, 'relative-strength.json');

const yf = new YF({ suppressNotices: ['yahooSurvey'] });

function loadJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function saveJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

async function withRetry(fn, retries = 1, delayMs = 400) {
  try {
    return await fn();
  } catch (err) {
    if (retries <= 0) throw err;
    await new Promise(resolve => setTimeout(resolve, delayMs));
    return withRetry(fn, retries - 1, delayMs);
  }
}

// Fetches one ticker's daily bars for [period1, period2]. Keeps `high`
// (needed for a faithful 52-week-high distance, RN-06) alongside open/close;
// drops volume/adjclose, unused by any business rule ported here.
async function fetchTickerBars(ticker, period1, period2) {
  const res = await withRetry(() => yf.chart(ticker, { period1, period2, interval: '1d' }));
  return res.quotes
    .filter(q => q.close != null)
    .map(q => ({
      date: q.date.toISOString().slice(0, 10),
      open: q.open,
      close: q.close,
      high: q.high ?? q.close
    }));
}

async function fetchAllBars(tickers, period1, period2) {
  const BATCH_SIZE = 5;
  const BATCH_DELAY_MS = 500;
  const results = {};
  const failed = [];

  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const batch = tickers.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(async ticker => {
      try {
        return { ticker, bars: await fetchTickerBars(ticker, period1, period2) };
      } catch (err) {
        console.error(`  ${ticker}: fetch failed - ${err.message}`);
        return { ticker, bars: null };
      }
    }));
    for (const { ticker, bars } of batchResults) {
      if (bars) results[ticker] = bars;
      else failed.push(ticker);
    }
    if (i + BATCH_SIZE < tickers.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }
  return { results, failed };
}

// Merges freshly-fetched bars into the existing rolling cache (last-write-wins
// per date, same idea as fetch-fed-liquidity.js's mergeSeries), then trims to
// the trailing WINDOW_DAYS calendar days so the cache doesn't grow forever.
function mergeAndTrim(existingBars, freshBars) {
  const byDate = new Map((existingBars || []).map(b => [b.date, b]));
  for (const b of freshBars) byDate.set(b.date, b);
  const merged = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - WINDOW_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return merged.filter(b => b.date >= cutoffStr);
}

// Excel/Google Sheets PERCENTRANK.INC: linear interpolation, inclusive rank
// in [0,1]. Ties resolve to the first index of the matching value in the
// sorted array (verified against PERCENTRANK.INC({1,2,2,3}, 2) = 0.333).
function percentrankInc(sortedAsc, x) {
  const n = sortedAsc.length;
  if (n < 2) return null;
  if (x < sortedAsc[0] || x > sortedAsc[n - 1]) return null;

  let lo = 0, hi = n - 1, k = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sortedAsc[mid] <= x) { k = mid; lo = mid + 1; }
    else hi = mid - 1;
  }

  if (sortedAsc[k] === x) {
    let first = k;
    while (first > 0 && sortedAsc[first - 1] === x) first--;
    return first / (n - 1);
  }
  const y0 = sortedAsc[k], y1 = sortedAsc[k + 1];
  return (k + (x - y0) / (y1 - y0)) / (n - 1);
}

function sortedSlice(arr, start, end) {
  return arr.slice(start, end).sort((a, b) => a - b);
}

// RN-01/02/03. `rsSeries` is chronological (index N-1 = most recent aligned
// session = "hoy" in this daily-batch adaptation - no live intraday feed).
function computeScoreAndDeltas(rsSeries) {
  const n = rsSeries.length;
  if (n < MIN_ALIGNED_SESSIONS) {
    return { score: null, delta1W: null, delta1M: null, insufficientHistory: true };
  }

  const today = rsSeries[n - 1];
  const score = percentrankInc(sortedSlice(rsSeries, n - SCORE_WINDOW, n), today);

  const anchor1W = rsSeries[n - 1 - DELTA_ANCHOR_OFFSET];
  const score1wAgo = percentrankInc(
    sortedSlice(rsSeries, n - DELTA_ANCHOR_OFFSET - SCORE_WINDOW, n - DELTA_ANCHOR_OFFSET),
    anchor1W
  );
  // RN-03: documented asymmetry, replicated as-is (confirmed with the
  // domain owner) - same anchor as 1W, but a 44-day window instead of 25.
  const score1mAgo = n - DELTA_ANCHOR_OFFSET - DELTA_1M_WINDOW >= 0
    ? percentrankInc(
        sortedSlice(rsSeries, n - DELTA_ANCHOR_OFFSET - DELTA_1M_WINDOW, n - DELTA_ANCHOR_OFFSET),
        anchor1W
      )
    : null;

  return {
    score,
    delta1W: score != null && score1wAgo != null ? (score - score1wAgo) * 100 : null,
    delta1M: score != null && score1mAgo != null ? (score - score1mAgo) * 100 : null,
    insufficientHistory: false
  };
}

// Latest bar with date <= targetDate (bars sorted ascending). Used for RN-06's
// reference-date returns - no weekend-string-matching (RN-07's fragile
// "domingo"/"sábado" locale hack): just walk back to the last real session.
function closeAtOrBefore(bars, targetDateStr) {
  for (let i = bars.length - 1; i >= 0; i--) {
    if (bars[i].date <= targetDateStr) return bars[i].close;
  }
  return null;
}

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// RN-06, adapted: "From Open" uses today's own bar's open/close (no live
// intraday quote here); YTD is computed dynamically from the last close of
// the prior calendar year, fixing BUG-01 (original hardcodes 2024-12-31).
function computeReturns(bars) {
  if (bars.length === 0) return null;
  const today = bars[bars.length - 1];
  const yesterday = bars.length > 1 ? bars[bars.length - 2] : null;

  const priorYearEnd = `${new Date().getUTCFullYear() - 1}-12-31`;
  const ytdClose = closeAtOrBefore(bars, priorYearEnd);
  const weekClose = closeAtOrBefore(bars, daysAgo(7));
  const monthClose = closeAtOrBefore(bars, daysAgo(30));
  const yoyClose = closeAtOrBefore(bars, daysAgo(365));

  // 52-week high approximated from trailing ~252 trading days' intraday highs
  // (not just closes) - closer to GOOGLEFINANCE "high52" semantics than a
  // close-only max would be.
  const window52w = bars.slice(-252);
  const high52 = window52w.length > 0 ? Math.max(...window52w.map(b => b.high)) : null;

  return {
    fromOpen: today.open ? today.close / today.open - 1 : null,
    day: yesterday ? today.close / yesterday.close - 1 : null,
    week: weekClose ? today.close / weekClose - 1 : null,
    month: monthClose ? today.close / monthClose - 1 : null,
    ytd: ytdClose ? today.close / ytdClose - 1 : null,
    yoy: yoyClose ? today.close / yoyClose - 1 : null,
    dist52wHigh: high52 ? today.close / high52 - 1 : null
  };
}

async function run() {
  const startedAt = Date.now();
  const priceCache = loadJson(pricesPath, { lastFetchedAt: null, tickers: {} });
  const tickers = UNIVERSE.map(u => u.ticker);

  const period2 = new Date();
  const coldStartPeriod1 = new Date(period2.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Per-ticker window, not one global one: a ticker just added to UNIVERSE
  // has no cache entry yet and needs the full cold-start backfill, even when
  // every other ticker (SPY included) only needs the narrow incremental
  // window. Using one global window keyed off SPY's cache state starved
  // newly-added tickers to ~10 days of history and wrongly flagged them
  // insufficientHistory - this is exactly the bug that surfaced when 10
  // tickers were added to UNIVERSE at once (see the 2026-08-05 resync note
  // above): they all got the incremental window instead of a real backfill.
  const coldTickers = [];
  const warmTickers = [];
  for (const ticker of tickers) {
    const existing = priceCache.tickers[ticker];
    // Threshold, not "has any entry": a ticker whose only cache is a partial
    // few days (e.g. left over from a run that hit this exact bug before the
    // fix) must still get treated as cold and re-backfilled, not incrementally
    // extended from an already-too-short window forever.
    (existing && existing.length >= MIN_ALIGNED_SESSIONS ? warmTickers : coldTickers).push(ticker);
  }

  let warmPeriod1 = coldStartPeriod1;
  const spyExisting = priceCache.tickers[BENCHMARK];
  if (spyExisting && spyExisting.length > 0) {
    // Incremental: refetch from 10 days before the latest cached date (small
    // overlap to catch any Yahoo restatement of the tail).
    const latestDate = new Date(spyExisting[spyExisting.length - 1].date + 'T00:00:00Z');
    warmPeriod1 = new Date(latestDate.getTime() - 10 * 24 * 60 * 60 * 1000);
  }

  console.log(`Fetching ${warmTickers.length} cached tickers from ${warmPeriod1.toISOString().slice(0, 10)}, ${coldTickers.length} new tickers from ${coldStartPeriod1.toISOString().slice(0, 10)} (both to ${period2.toISOString().slice(0, 10)})...`);
  // Sequential, not Promise.all: each fetchAllBars() already internally caps
  // concurrency at BATCH_SIZE - running both groups in parallel would double
  // that ceiling against Yahoo for no real benefit (coldTickers is normally
  // a handful of newly-added tickers, not the whole universe).
  const warmFetch = warmTickers.length > 0 ? await fetchAllBars(warmTickers, warmPeriod1, period2) : { results: {}, failed: [] };
  const coldFetch = coldTickers.length > 0 ? await fetchAllBars(coldTickers, coldStartPeriod1, period2) : { results: {}, failed: [] };
  const results = { ...warmFetch.results, ...coldFetch.results };
  const failed = [...warmFetch.failed, ...coldFetch.failed];

  for (const ticker of Object.keys(results)) {
    priceCache.tickers[ticker] = mergeAndTrim(priceCache.tickers[ticker], results[ticker]);
  }
  priceCache.lastFetchedAt = new Date().toISOString();
  saveJson(pricesPath, priceCache);

  const spyBars = priceCache.tickers[BENCHMARK];
  if (!spyBars || spyBars.length < MIN_ALIGNED_SESSIONS) {
    // `throw`, not `process.exit()` - this function also runs in-process
    // inside the /api/relative-strength/refresh route handler, where exiting
    // would kill the whole Next.js server, not just this request.
    throw new Error(`Not enough SPY history to compute anything (${spyBars?.length ?? 0} sessions)`);
  }
  const spyCloseByDate = new Map(spyBars.map(b => [b.date, b.close]));
  const canonicalDates = spyBars.map(b => b.date); // SPY's own sessions are the calendar

  const universeOut = [];
  const skippedTickers = [...failed];

  for (const { ticker, name } of UNIVERSE) {
    const bars = priceCache.tickers[ticker];
    if (!bars || bars.length === 0) {
      if (!skippedTickers.includes(ticker)) skippedTickers.push(ticker);
      continue;
    }

    if (ticker === BENCHMARK) {
      universeOut.push({
        ticker, name, price: bars[bars.length - 1].close,
        score: null, delta1W: null, delta1M: null, rsSpark: [],
        returns: computeReturns(bars), insufficientHistory: false, isBenchmark: true
      });
      continue;
    }

    // RN-01: RS(t,d) = P(t,d)/P(SPY,d), only on days both have a close - no
    // forward-fill (a duplicated flat value would distort PERCENTRANK.INC).
    const barByDate = new Map(bars.map(b => [b.date, b]));
    const rsSeries = [];
    for (const date of canonicalDates) {
      const bar = barByDate.get(date);
      const spyClose = spyCloseByDate.get(date);
      if (bar && spyClose) rsSeries.push(bar.close / spyClose);
    }

    const { score, delta1W, delta1M, insufficientHistory } = computeScoreAndDeltas(rsSeries);

    universeOut.push({
      ticker,
      name,
      price: bars[bars.length - 1].close,
      score,
      delta1W,
      delta1M,
      rsSpark: rsSeries.slice(-25),
      returns: computeReturns(bars),
      insufficientHistory
    });
  }

  const insufficientCount = universeOut.filter(u => u.insufficientHistory).length;
  const output = {
    asOf: spyBars[spyBars.length - 1].date,
    generatedAt: new Date().toISOString(),
    benchmark: BENCHMARK,
    universe: universeOut,
    meta: {
      tickerCount: universeOut.length,
      insufficientCount,
      skippedTickers
    }
  };
  saveJson(outputPath, output);

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`Done in ${elapsedSec}s. ${universeOut.length}/${UNIVERSE.length} tickers written, ${insufficientCount} with insufficient history, ${skippedTickers.length} skipped entirely.`);
  if (skippedTickers.length > 0) console.log(`Skipped: ${skippedTickers.join(', ')}`);

  return output;
}

// Exported so src/app/api/relative-strength/refresh/route.ts can trigger a
// real fetch+recompute on demand (the dashboard's refresh button) without
// shelling out to a child process - same require.main guard pattern as
// generate-institutional-analysis.js/export-cowork-prompt.js.
module.exports = { run };

if (require.main === module) {
  run().catch(err => {
    console.error('Failed to fetch relative strength data:', err.message);
    process.exit(1);
  });
}
