const fs = require('fs');
const path = require('path');
const YFMod = require('yahoo-finance2');
const YF = YFMod.default || YFMod;

// Powers the top-10-holdings hover tooltip on ETF tickers in FundFlowPanel
// and RelativeStrengthPanel. Yahoo's quoteSummary `topHoldings` module
// normalizes this across ANY issuer (SSGA, iShares, Global X, Defiance,
// VanEck, ...) under one free, unauthenticated endpoint - no per-issuer
// scraper needed, unlike an iShares/SSGA/Invesco-only approach would
// require (that would miss most of the boutique-issuer tickers in
// UNIVERSE below, e.g. BOTZ/QTUM/DRNZ). It only ever returns the top ~10,
// which is exactly what the tooltip needs - there is no "ver más" beyond
// this, by design (see conversation this was scoped in).
//
// Weights barely move quarter to quarter, so this only re-fetches when the
// cache is older than REFRESH_INTERVAL_DAYS - safe to run in any daily job
// (chained into relative-strength-refresh, see .circleci/config.yml)
// without hammering Yahoo. 90 days approximates the quarterly rebalance
// cadence (S&P/sector SPDRs rebalance ~third Friday of Mar/Jun/Sep/Dec);
// an elapsed-time check instead of tracking exact calendar rebalance dates
// per issuer, since the ~70 tickers here span many different providers
// (SSGA, iShares, Global X, VanEck, ...) each with their own schedule -
// no single "the rebalance date" exists across all of them.
const REFRESH_INTERVAL_DAYS = 90;

// Union of SECTOR_FLOW_TICKERS (src/app/page.tsx, drives FundFlowPanel) and
// UNIVERSE (scripts/fetch-relative-strength.js, drives RelativeStrengthPanel)
// - kept as an independent literal here, same duplication convention this
// codebase already uses for ticker lists (e.g. FLOW_TICKERS in
// generate-institutional-analysis.js duplicates SECTOR_FLOW_TICKERS too).
// Keep in sync manually if either source list changes.
const TICKERS = [
  // SECTOR_FLOW_TICKERS-only additions (rest overlaps with UNIVERSE below)
  'QQQ', 'GLD', 'XLRE',
  // UNIVERSE (scripts/fetch-relative-strength.js)
  'SPY', 'XLK', 'SMH', 'XTL', 'IGV', 'FDN', 'HACK', 'CIBR', 'ROBO', 'BOTZ',
  'QTUM', 'BLOK', 'NASA', 'DRNZ', 'SHLD', 'DRAM', 'AIQ', 'KWEB', 'XLF',
  'IPAY', 'KRE', 'KBE', 'KCE', 'IAI', 'KIE', 'XLY', 'PEJ', 'XRT', 'PBJ',
  'XLC', 'SOCL', 'IYZ', 'IXP', 'XLV', 'IHI', 'XHS', 'XPH', 'IBB', 'XBI',
  'XLI', 'JETS', 'BOAT', 'ITA', 'IYT', 'IDRV', 'XLP', 'XLE', 'XOP', 'OIH',
  'MLPX', 'XLU', 'TAN', 'PBW', 'IYR', 'ITB', 'MOO', 'VEGI', 'XLB', 'GDX',
  'XME', 'URA', 'NLR', 'REMX', 'COPX', 'SLX', 'SIL', 'RSP', 'IWM', 'IWF',
  'IWD'
];

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

function isStale(cache) {
  if (!cache || !cache.asOf) return true;
  const ageMs = Date.now() - new Date(cache.asOf).getTime();
  return ageMs > REFRESH_INTERVAL_DAYS * 24 * 60 * 60 * 1000;
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

async function fetchOne(ticker) {
  const res = await withRetry(() => yf.quoteSummary(ticker, { modules: ['topHoldings', 'price'] }));
  const holdings = (res.topHoldings?.holdings ?? []).map(h => ({
    ticker: h.symbol,
    name: h.holdingName,
    weight: Math.round(h.holdingPercent * 10000) / 100 // 0.0755 -> 7.55
  }));
  if (holdings.length === 0) return null;
  return {
    name: res.price?.longName ?? res.price?.shortName ?? ticker,
    holdings
  };
}

async function run() {
  const existing = loadJson(outputPath, null);
  if (!isStale(existing)) {
    console.log(`ETF holdings cache is fresh (as of ${existing.asOf}, refreshes every ${REFRESH_INTERVAL_DAYS}d) - skipping.`);
    return existing;
  }

  const BATCH_SIZE = 5;
  const BATCH_DELAY_MS = 500;
  const tickers = { ...(existing?.tickers ?? {}) };
  const failed = [];

  for (let i = 0; i < TICKERS.length; i += BATCH_SIZE) {
    const batch = TICKERS.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(async ticker => {
      try {
        return { ticker, data: await fetchOne(ticker) };
      } catch (err) {
        console.error(`  ${ticker}: fetch failed - ${err.message}`);
        return { ticker, data: null };
      }
    }));
    for (const { ticker, data } of results) {
      if (data) tickers[ticker] = data;
      else failed.push(ticker);
    }
    if (i + BATCH_SIZE < TICKERS.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  const output = {
    asOf: new Date().toISOString(),
    tickers
  };
  saveJson(outputPath, output);

  console.log(`ETF holdings updated: ${Object.keys(tickers).length}/${TICKERS.length} tickers.${failed.length > 0 ? ` Failed: ${failed.join(', ')}` : ''}`);
  return output;
}

module.exports = { run };

if (require.main === module) {
  run().catch(err => {
    console.error('Failed to fetch ETF holdings:', err.message);
    process.exit(1);
  });
}
