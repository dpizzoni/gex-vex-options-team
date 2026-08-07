require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { ensureLoggedIn, STATE_FILE } = require('./uw-session');

// Built from scripts/uw-fetch-fund-flow-discovery.js's findings (see
// debug/fund-flow/*/responses.json from that run): /api/sector/etfs and
// /api/net-flow-ticks already return server-side daily aggregates - a single
// end-of-day snapshot is a real, complete daily total for both, no polling/
// accumulation needed.

const cacheDir = path.join(__dirname, '..', 'cache');

// The 11 SPDR sector ETFs + SPY - exactly what /api/sector/etfs returns.
const SECTOR_TICKERS = ['SPY', 'XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLRE', 'XLU', 'XLV', 'XLY'];

// /api/sector/etfs' in_out_flow window is only ~5 trading days deep, and it
// doesn't cover QQQ/IWM/GLD at all (SPDR-sector-only). /api/etfs/{TICKER}/stats
// on each ETF's own /etf/{TICKER} page covers ANY ETF - including every
// SECTOR_TICKERS name - with the SAME `change` field ($ scale) but going
// back much further (100s of rows vs ~5). Runs for every ticker so the
// short-window in_out_flow data from /api/sector/etfs gets backfilled with
// deep history; updateEtfStatsFundFlow only touches last/prev_close/volume/
// net_flow fields, so call_premium/put_premium/etc from the sector fetch
// above are preserved untouched on days both endpoints cover.
// GLD (gold) rides this same generic path, not the sector one - it's not an
// SPDR sector ETF, just another ticker /api/etfs/{TICKER}/stats happens to
// support - added to give the institutional analysis a real $ flow signal
// for gold alongside its COT positioning (GC, see fetch-cot-report.js).
const ETF_STATS_TICKERS = [...SECTOR_TICKERS, 'QQQ', 'IWM', 'GLD'];

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

async function captureJson(page, url, urlPattern, { timeoutMs = 20000, settleMs = 5000 } = {}) {
  let captured = null;
  const listener = async (response) => {
    if (captured) return;
    if (!urlPattern.test(response.url())) return;
    try {
      const body = await response.json();
      captured = body;
    } catch (e) {
      // ignore non-JSON/already-consumed bodies
    }
  };
  page.on('response', listener);

  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

  const start = Date.now();
  while (!captured && Date.now() - start < timeoutMs) {
    await page.waitForTimeout(300);
  }
  // Even after the target response lands, give the page a moment in case
  // more relevant calls follow (matches the "settle" pause used elsewhere).
  await page.waitForTimeout(settleMs);

  page.off('response', listener);
  if (!captured) throw new Error(`Timed out waiting for ${urlPattern}`);
  return captured;
}

function loadJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

// /api/sector/etfs returns one row per ticker for "today" plus a ~5-day
// in_out_flow trailing window (real $ ETF creation/redemption flow), in full,
// on every single call - not just the latest day. Backfilling all of it every
// run (instead of only the most recent entry) means a brand-new ticker gets
// several real days of flow history in one run, rather than waiting a week of
// daily crons to build up that same window one day at a time.
function updateSectorFundFlow(sectorEtfRows) {
  for (const row of sectorEtfRows) {
    if (!SECTOR_TICKERS.includes(row.ticker)) continue;
    const filePath = path.join(cacheDir, `fund-flow-${row.ticker}.json`);
    const history = loadJson(filePath, []);
    const byDate = new Map(history.map(h => [h.date, h]));

    // `date` is the capture day for the live snapshot fields (call_premium,
    // volume, etc.) - todayStr() is fine for this since the workflow runs at
    // 21:00 UTC, safely same-day as the US market close in both EST/EDT.
    const today = todayStr();
    byDate.set(today, {
      ...(byDate.get(today) ?? {}),
      date: today,
      last: parseFloat(row.last),
      prev_close: parseFloat(row.prev_close),
      call_premium: parseFloat(row.call_premium),
      put_premium: parseFloat(row.put_premium),
      bullish_premium: parseFloat(row.bullish_premium),
      bearish_premium: parseFloat(row.bearish_premium),
      call_volume: row.call_volume,
      put_volume: row.put_volume,
      volume: row.volume
    });

    // net_flow is a different story from the snapshot fields above:
    // in_out_flow (real $ ETF creation/redemption) lags behind - each entry's
    // own `date` IS its real trading day, unlike todayStr(). Upsert every
    // entry in the window onto whatever cache row already exists for that
    // date (or a new flow-only row if none does yet), instead of forcing a
    // same-day match against just one of them.
    const flowEntries = Array.isArray(row.in_out_flow) ? row.in_out_flow : [];
    let latestFlow = null;
    for (const flow of flowEntries) {
      const existing = byDate.get(flow.date) ?? { date: flow.date };
      byDate.set(flow.date, { ...existing, net_flow: flow.change, net_flow_date: flow.date });
      if (!latestFlow || flow.date > latestFlow.date) latestFlow = flow;
    }
    // Also mirror the latest known flow value onto today's snapshot entry, so
    // "today's" row in the UI always shows the most recent flow figure
    // available, same as before this backfill was added.
    if (latestFlow) {
      const todayEntry = byDate.get(today);
      byDate.set(today, { ...todayEntry, net_flow: latestFlow.change, net_flow_date: latestFlow.date });
    }

    const merged = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
    writeJson(filePath, merged);
  }
}

// /api/etfs/{TICKER}/stats returns rows newest-first, each `change` already
// a real daily $ total (no polling/backfill-window juggling needed, unlike
// the sector endpoint's separate in_out_flow array) - same idea as
// updateSectorFundFlow but simpler since date and flow live on the same row.
// prev_close comes from the next (older) row in that same descending array.
function updateEtfStatsFundFlow(ticker, statsRows) {
  const filePath = path.join(cacheDir, `fund-flow-${ticker}.json`);
  const history = loadJson(filePath, []);
  const byDate = new Map(history.map(h => [h.date, h]));

  statsRows.forEach((row, i) => {
    const prevRow = statsRows[i + 1];
    const existing = byDate.get(row.date) ?? { date: row.date };
    byDate.set(row.date, {
      ...existing,
      date: row.date,
      last: parseFloat(row.close),
      prev_close: prevRow ? parseFloat(prevRow.close) : existing.prev_close,
      volume: row.volume,
      net_flow: row.change,
      net_flow_date: row.date
    });
  });

  const merged = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  writeJson(filePath, merged);
}

// /api/net-flow-ticks (market_day_timeframe=1) returns per-minute market-wide
// net call/put premium, not a cumulative total - the last row(s) are null
// while the current minute is still in progress. Summing the completed
// minutes gives today's real net total (same idea as the "Market Tide"
// chart, which plots the running cumulative sum of this same series).
function summarizeMarketTide(netFlowTicksRows) {
  let netCallPremium = 0;
  let netPutPremium = 0;
  let minutesCaptured = 0;
  for (const row of netFlowTicksRows) {
    if (row.net_call_premium == null || row.net_put_premium == null) continue;
    netCallPremium += parseFloat(row.net_call_premium);
    netPutPremium += parseFloat(row.net_put_premium);
    minutesCaptured += 1;
  }
  return { netCallPremium, netPutPremium, minutesCaptured };
}

function updateMarketTide(netFlowTicksRows) {
  const filePath = path.join(cacheDir, 'market-tide.json');
  const history = loadJson(filePath, []);
  // Same reasoning as updateSectorFundFlow: trust the trading date the API
  // itself reports on each row over the runner's UTC clock.
  const today = netFlowTicksRows.find(r => r.date)?.date ?? todayStr();
  const { netCallPremium, netPutPremium, minutesCaptured } = summarizeMarketTide(netFlowTicksRows);

  const entry = {
    date: today,
    net_call_premium: Math.round(netCallPremium),
    net_put_premium: Math.round(netPutPremium),
    minutes_captured: minutesCaptured
  };

  const withoutToday = history.filter(h => h.date !== today);
  withoutToday.push(entry);
  withoutToday.sort((a, b) => a.date.localeCompare(b.date));
  writeJson(filePath, withoutToday);
}

async function run() {
  const browser = await chromium.launch({ headless: process.env.CI ? true : false, args: ['--start-maximized', '--disable-features=Translate'] });
  const contextOptions = {
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'es-AR'
  };
  if (fs.existsSync(STATE_FILE)) contextOptions.storageState = STATE_FILE;
  const context = await browser.newContext(contextOptions);

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });

  const page = await context.newPage();
  await ensureLoggedIn(page, context);

  try {
    console.log('Fetching sector ETF flow...');
    const sectorEtfs = await captureJson(
      page,
      'https://unusualwhales.com/flow/sectors?tab=flow',
      /\/api\/sector\/etfs/
    );
    updateSectorFundFlow(sectorEtfs.data);
    console.log(`  Updated fund-flow-{TICKER}.json for ${SECTOR_TICKERS.length} sector ETFs.`);
  } catch (err) {
    console.error('Failed to fetch sector ETF flow:', err.message);
  }

  for (const ticker of ETF_STATS_TICKERS) {
    try {
      console.log(`Fetching ${ticker} ETF flow...`);
      const stats = await captureJson(
        page,
        `https://unusualwhales.com/etf/${ticker}`,
        new RegExp(`/api/etfs/${ticker}/stats`)
      );
      updateEtfStatsFundFlow(ticker, stats.data);
      console.log(`  Updated fund-flow-${ticker}.json.`);
    } catch (err) {
      console.error(`Failed to fetch ${ticker} ETF flow:`, err.message);
    }
  }

  try {
    console.log('Fetching market tide...');
    const netFlowTicks = await captureJson(
      page,
      'https://unusualwhales.com/flow/overview',
      /\/api\/net-flow-ticks\?/
    );
    updateMarketTide(netFlowTicks.data);
    console.log('  Updated market-tide.json.');
  } catch (err) {
    console.error('Failed to fetch market tide:', err.message);
  }

  await browser.close();
}

run();
