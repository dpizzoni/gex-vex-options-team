require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { ensureLoggedIn, STATE_FILE } = require('./uw-session');

// Exploratory-only script for the fund-flow feature (sector flow, market
// tide). Unlike uw-fetch-gamma-data.js, which already knows the exact
// /api/gex/{ticker} response shape to wait for, we don't yet know what
// network calls these pages make. This captures every JSON XHR/fetch
// response plus a full HTML dump and screenshot per page, so the real
// endpoints/selectors can be inspected before writing the real scraper.
// Writes nothing to cache/ - output only goes to debug/fund-flow/.
//
// large-trades (whale/dark-pool) was explored here too, but dropped from the
// feature entirely: it's only the last 50 trades market-wide with no date
// filter, so it can't produce a real daily total - not useful for this.

const PAGES = [
  { name: 'flow-sectors', url: 'https://unusualwhales.com/flow/sectors?tab=flow' },
  { name: 'flow-overview', url: 'https://unusualwhales.com/flow/overview' }
];

const debugDir = path.join(__dirname, '..', 'debug', 'fund-flow');

async function capturePage(page, { name, url }) {
  const responses = [];

  const listener = async (response) => {
    const reqUrl = response.url();
    const contentType = response.headers()['content-type'] || '';
    if (!contentType.includes('application/json')) return;
    try {
      const body = await response.json();
      responses.push({ url: reqUrl, status: response.status(), body });
    } catch (e) {
      // ignore bodies that fail to parse (already consumed, empty, etc.)
    }
  };
  page.on('response', listener);

  console.log(`Navigating to ${name} (${url})...`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  // Give client-side widgets (tables, charts) time to fire their data calls
  // after the initial navigation settles.
  await page.waitForTimeout(5000);

  page.off('response', listener);

  const pageDir = path.join(debugDir, name);
  fs.mkdirSync(pageDir, { recursive: true });

  fs.writeFileSync(path.join(pageDir, 'page.html'), await page.content(), 'utf8');
  await page.screenshot({ path: path.join(pageDir, 'screenshot.png'), fullPage: true });
  fs.writeFileSync(
    path.join(pageDir, 'responses.json'),
    JSON.stringify(responses, null, 2),
    'utf8'
  );

  console.log(`  Captured ${responses.length} JSON response(s), HTML + screenshot saved to ${pageDir}`);
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

  for (const target of PAGES) {
    try {
      await capturePage(page, target);
    } catch (err) {
      console.error(`Failed for ${target.name}:`, err.message);
    }
  }

  await browser.close();
  console.log(`\nDone. Inspect debug/fund-flow/*/{page.html,screenshot.png,responses.json}`);
}

run();
