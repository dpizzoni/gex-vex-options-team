require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { ensureLoggedIn, STATE_FILE } = require('./uw-session');

const cacheDir = path.join(__dirname, '..', 'cache');
const DISPLAY_DAYS = 30;
const MAX_DTE = 40;

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

// Single page load per ticker capturing all three endpoints the page fires anyway
// (history, by-expiry, by-strike), instead of the two separate page loads that
// uw-fetch-gamma-history.js + uw-fetch-gamma-forward.js used to require.
async function fetchTickerData(page, ticker) {
  let historyCaptured = null;
  let expiryCaptured = null;
  let strikeCaptured = null;

  const historyPattern = new RegExp(`/api/gex/${ticker}\\?timespan=1y`);
  const expiryPattern = new RegExp(`/api/gex/${ticker}/expiry\\?date=`);
  const strikePattern = new RegExp(`/api/gex/${ticker}/strike\\?date=`);

  const listener = async (response) => {
    const url = response.url();
    try {
      if (historyPattern.test(url)) {
        const body = await response.json();
        if (body && Array.isArray(body.data)) historyCaptured = body;
      } else if (expiryPattern.test(url)) {
        const body = await response.json();
        if (body && Array.isArray(body.data)) expiryCaptured = body;
      } else if (strikePattern.test(url)) {
        const body = await response.json();
        if (body && Array.isArray(body.data)) strikeCaptured = body;
      }
    } catch (e) {
      // ignore non-JSON or already-consumed bodies
    }
  };
  page.on('response', listener);

  await page.goto(`https://unusualwhales.com/stock/${ticker}/greek-exposure?tab=Gamma`, {
    waitUntil: 'networkidle',
    timeout: 30000
  });

  const start = Date.now();
  while ((!historyCaptured || !expiryCaptured || !strikeCaptured) && Date.now() - start < 15000) {
    await page.waitForTimeout(500);
  }

  page.off('response', listener);

  if (!historyCaptured) throw new Error(`Timed out waiting for /api/gex/${ticker}?timespan=1y response`);
  if (!expiryCaptured) throw new Error(`Timed out waiting for /api/gex/${ticker}/expiry response`);
  if (!strikeCaptured) throw new Error(`Timed out waiting for /api/gex/${ticker}/strike response`);

  return { historyData: historyCaptured.data, expiryData: expiryCaptured.data, strikeData: strikeCaptured.data };
}

function buildHistory(ticker, rawData) {
  const sorted = [...rawData].sort((a, b) => a.date.localeCompare(b.date));
  const trimmed = sorted.slice(-DISPLAY_DAYS);
  const history = [];
  let ema3 = null;

  for (const row of trimmed) {
    const callGex = parseFloat(row.call_gex);
    const putGex = parseFloat(row.put_gex);
    const callVex = parseFloat(row.call_vanna);
    const putVex = parseFloat(row.put_vanna);
    const netGex = callGex + putGex;
    const netVex = callVex + putVex;

    ema3 = ema3 === null ? netGex : 0.5 * netGex + 0.5 * ema3;

    history.push({
      date: row.date,
      ticker,
      spot: parseFloat(row.close),
      call_gex: Math.round(callGex),
      put_gex: Math.round(putGex),
      net_gex: Math.round(netGex),
      call_vex: Math.round(callVex),
      put_vex: Math.round(putVex),
      net_vex: Math.round(netVex),
      king_node: null,
      ema3_net_gex: Math.round(ema3)
    });
  }
  return history;
}

function buildForwardBars(expiryData) {
  return expiryData
    .filter(row => row.dte > 0 && row.dte <= MAX_DTE)
    .sort((a, b) => a.dte - b.dte)
    .map(row => {
      const callGex = parseFloat(row.call_gex);
      const putGex = parseFloat(row.put_gex);
      const netGex = callGex + putGex;
      const pcRatio = Math.abs(putGex) / Math.max(callGex, 0.0001);
      return {
        expiration: row.expiry,
        dte: row.dte,
        call_gex: Math.round(callGex),
        put_gex: Math.round(putGex),
        net_gex: Math.round(netGex),
        p_c_ratio: parseFloat(pcRatio.toFixed(4))
      };
    });
}

function computeWalls(strikeData, spot) {
  if (spot == null) return { putWall: null, callWall: null };

  const parsed = strikeData.map(r => ({
    strike: parseFloat(r.strike),
    call_gex: parseFloat(r.call_gex),
    put_gex: parseFloat(r.put_gex)
  }));

  const putWallRow = parsed
    .filter(r => r.strike < spot)
    .reduce((best, r) => (!best || Math.abs(r.put_gex) > Math.abs(best.put_gex)) ? r : best, null);

  const callWallRow = parsed
    .filter(r => r.strike > spot)
    .reduce((best, r) => (!best || Math.abs(r.call_gex) > Math.abs(best.call_gex)) ? r : best, null);

  return {
    putWall: putWallRow ? putWallRow.strike : null,
    callWall: callWallRow ? callWallRow.strike : null
  };
}

async function run() {
  const tickers = process.argv.slice(2).filter(a => !a.startsWith('--'));
  if (tickers.length === 0) {
    console.error('Usage: node scripts/uw-fetch-gamma-data.js TICKER [TICKER2 ...]');
    process.exit(1);
  }
  const browser = await chromium.launch({ headless: process.env.CI ? true : false, args: ['--start-maximized', '--disable-features=Translate'] });
  // auth_state.json is gitignored, so it won't exist on a fresh CI checkout;
  // ensureLoggedIn() below performs a full fresh login via UW_EMAIL/UW_PASSWORD
  // in that case, mirroring uw-window-fetch.js's proven pattern.
  // Explicit viewport (matching uw-window-fetch.js, the proven-on-CI script)
  // instead of `viewport: null`: with no real window in headless mode, `null`
  // disables viewport emulation entirely, which likely left UW's lazy-loaded
  // Gamma Exposure widgets thinking they had no visible area to render into.
  const contextOptions = {
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'es-AR'
  };
  if (fs.existsSync(STATE_FILE)) contextOptions.storageState = STATE_FILE;
  const context = await browser.newContext(contextOptions);

  // Stealth: bypass navigator.webdriver detection, same as uw-window-fetch.js.
  // The real root cause of every ticker returning empty data on CI: without
  // this, headless Chromium's default UA ("HeadlessChrome...") and the
  // navigator.webdriver flag are trivially detectable, and UW appears to
  // silently serve a degraded/empty response instead of erroring.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });

  const page = await context.newPage();

  await ensureLoggedIn(page, context);

  const overallStart = Date.now();
  const upperTickers = tickers.map(t => t.toUpperCase());
  for (let i = 0; i < upperTickers.length; i++) {
    const ticker = upperTickers[i];
    const tickerStart = Date.now();
    try {
      console.log(`Fetching gamma data for ${ticker}...`);
      const { historyData, expiryData, strikeData } = await fetchTickerData(page, ticker);

      const history = buildHistory(ticker, historyData);
      fs.writeFileSync(path.join(cacheDir, `regime-history-${ticker}.json`), JSON.stringify(history, null, 2), 'utf8');

      const spot = history.length > 0 ? history[history.length - 1].spot : null;
      const expirations = buildForwardBars(expiryData);
      const { putWall, callWall } = computeWalls(strikeData, spot);
      const forwardObj = {
        ticker,
        date: todayStr(),
        spot,
        expirations,
        putWall,
        callWall,
        limitedData: expirations.length < 3
      };
      fs.writeFileSync(path.join(cacheDir, `gamma-forward-${ticker}.json`), JSON.stringify(forwardObj, null, 2), 'utf8');

      console.log(`Saved ${history.length} history days + ${expirations.length} forward expirations for ${ticker} [${((Date.now() - tickerStart) / 1000).toFixed(1)}s]`);
    } catch (err) {
      console.error(`Failed for ${ticker}:`, err.message, `[${((Date.now() - tickerStart) / 1000).toFixed(1)}s]`);
    }

    // Small pause every 20 tickers to avoid tripping anti-bot rate limiting at scale.
    if ((i + 1) % 20 === 0 && i + 1 < upperTickers.length) {
      await page.waitForTimeout(3000);
    }
  }
  console.log(`TOTAL_ELAPSED_SECONDS=${((Date.now() - overallStart) / 1000).toFixed(1)}`);

  await browser.close();
  process.exit(0);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
