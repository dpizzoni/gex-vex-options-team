require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { getCacheDir } = require('./cache-resolver');

const STATE_FILE = path.join(__dirname, '..', 'auth_state.json');
const cacheUwDir = path.join(__dirname, '..', 'cache', 'uw');
const errorsFile = path.join(__dirname, '..', 'errors.json');

// Ensure output directories exist
if (!fs.existsSync(cacheUwDir)) fs.mkdirSync(cacheUwDir, { recursive: true });

async function getYahooData(ticker, expiration = null) {
  const url = expiration 
    ? `http://127.0.0.1:8000/api/options?symbol=${ticker}&expiration=${expiration}`
    : `http://127.0.0.1:8000/api/options?symbol=${ticker}`;
  
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP status ${res.status}`);
    return await res.json();
  } catch (err) {
    // Fallback to Next.js dev server port
    const fallbackUrl = expiration 
      ? `http://127.0.0.1:3002/api/options?symbol=${ticker}&expiration=${expiration}`
      : `http://127.0.0.1:3002/api/options?symbol=${ticker}`;
    const res = await fetch(fallbackUrl);
    if (!res.ok) throw new Error(`HTTP status ${res.status}`);
    return await res.json();
  }
}

async function expandTable(page) {
  try {
    const buttons = await page.$$('button, a, [role="button"]');
    for (const btn of buttons) {
      const text = await btn.innerText();
      if (text && (text.toLowerCase().includes('more') || text.toLowerCase().includes('show') || text.toLowerCase().includes('expand'))) {
        console.log(`Found expand button: "${text}". Clicking it.`);
        await btn.click();
        await page.waitForTimeout(1000);
        break;
      }
    }
  } catch (err) {
    console.log(`Note: Expand button check failed: ${err.message}`);
  }
}

async function fetchContract(page, contractId) {
  const chainUrl = `https://unusualwhales.com/flow/option_chains?chain=${contractId}`;
  
  // Navigation
  await page.goto(chainUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Esperar tabla
  await page.waitForFunction(() => {
    const hasText = document.body.innerText.includes("Historical Volume / OI");
    if (!hasText) return false;
    const tables = Array.from(document.querySelectorAll('table'));
    const targetTable = tables.find(t => {
      const ths = Array.from(t.querySelectorAll('th')).map(th => th.textContent.trim().toLowerCase());
      return ths.includes('date') && ths.includes('oi') && ths.includes('bid/ask');
    });
    if (!targetTable) return false;
    const rows = targetTable.querySelectorAll('tbody tr');
    return rows.length > 0;
  }, { timeout: 15000 });

  // Expand table
  await expandTable(page);

  // Extract data with page.evaluate
  const history = await page.evaluate((cId) => {
    const match = cId.match(/^([a-zA-Z]+)(\d{6})([CP])(\d{8})$/);
    const symbol = match ? match[1] : 'SPY';
    const expiryStr = cId.substring(symbol.length, symbol.length + 6);
    const yy = expiryStr.substring(0, 2);
    const mm = expiryStr.substring(2, 4);
    const dd = expiryStr.substring(4, 6);
    const expYear = parseInt(`20${yy}`, 10);
    const expMonth = parseInt(mm, 10);
    const expDay = parseInt(dd, 10);

    const candidates = Array.from(document.querySelectorAll('*')).filter(el => {
      if (!el.textContent || !el.textContent.includes('Historical Volume / OI')) return false;
      const children = Array.from(el.children);
      const hasChildWithText = children.some(child => child.textContent && child.textContent.includes('Historical Volume / OI'));
      return !hasChildWithText;
    });
    
    const header = candidates[0];
    if (!header) return null;
    
    let node = header;
    let table = null;
    while (node && node !== document.body) {
      let sibling = node.nextElementSibling;
      while (sibling) {
        table = sibling.querySelector('table') || (sibling.tagName === 'TABLE' ? sibling : null);
        if (table) break;
        sibling = sibling.nextElementSibling;
      }
      if (table) break;
      node = node.parentElement;
    }
    
    if (!table) {
      const allTables = Array.from(document.querySelectorAll('table'));
      table = allTables.find(t => {
        const ths = Array.from(t.querySelectorAll('th')).map(th => th.textContent.trim().toLowerCase());
        return ths.includes('date') && ths.includes('oi') && ths.includes('bid/ask');
      });
    }

    if (!table) return null;

    const ths = Array.from(table.querySelectorAll('th')).map(th => th.textContent.trim().toLowerCase());
    const dateIdx = ths.indexOf('date') !== -1 ? ths.indexOf('date') : 0;
    const oiIdx = ths.indexOf('oi') !== -1 ? ths.indexOf('oi') : 2;
    const bidAskIdx = ths.indexOf('bid/ask') !== -1 ? ths.indexOf('bid/ask') : 7;

    const rows = Array.from(table.querySelectorAll('tbody tr'));
    const data = [];
    
    let currentYear = expYear;
    let lastMonth = null;
    
    for (let i = 0; i < rows.length; i++) {
      const tr = rows[i];
      const tds = Array.from(tr.querySelectorAll('td'));
      if (tds.length <= Math.max(dateIdx, oiIdx, bidAskIdx)) continue;

      const dateText = tds[dateIdx].textContent.trim();
      const parts = dateText.split('/');
      if (parts.length < 2) continue;
      const rowDay = parseInt(parts[0], 10);
      const rowMonth = parseInt(parts[1], 10);
      
      if (i === 0) {
        if (rowMonth > expMonth || (rowMonth === expMonth && rowDay > expDay)) {
          currentYear = expYear - 1;
        } else {
          currentYear = expYear;
        }
      } else {
        if (lastMonth !== null && rowMonth > lastMonth) {
          currentYear--;
        }
      }
      lastMonth = rowMonth;
      
      const formattedDate = `${currentYear}-${String(rowMonth).padStart(2, '0')}-${String(rowDay).padStart(2, '0')}`;
      
      const oiText = tds[oiIdx].textContent.replace(/,/g, '').trim();
      const oi = parseInt(oiText, 10);
      
      const bidAskTd = tds[bidAskIdx];
      const redDiv = bidAskTd.querySelector('div[class*="rose"], div[class*="red"]');
      const greenDiv = bidAskTd.querySelector('div[class*="emerald"], div[class*="green"]');
      
      const redValStr = redDiv ? redDiv.textContent.trim() : '';
      const greenValStr = greenDiv ? greenDiv.textContent.trim() : '';
      
      let bidAskVal = 0.5;
      
      if (redValStr && redValStr.includes('%')) {
        bidAskVal = parseFloat(redValStr.replace('%', '')) / 100;
      } else if (greenValStr && greenValStr.includes('%')) {
        bidAskVal = parseFloat(greenValStr.replace('%', '')) / 100;
      } else {
        const cellText = bidAskTd.textContent.trim();
        if (cellText.includes('%')) {
          bidAskVal = parseFloat(cellText.replace('%', '')) / 100;
        }
      }

      let redWidth = 0;
      let greenWidth = 0;

      const colorDivs = Array.from(bidAskTd.querySelectorAll('div[style*="background-color"]'));
      colorDivs.forEach(d => {
        const bg = d.style.backgroundColor;
        const w = parseFloat(d.style.width) || 0;
        if (bg.includes('var(--danger)')) redWidth = w;
        if (bg.includes('var(--success)')) greenWidth = w;
      });

      let bidAskColor = 'unknown';
      const diff = Math.abs(redWidth - greenWidth);

      if (redWidth > 0 || greenWidth > 0) {
        if (diff < 15) {
          bidAskColor = 'unknown';
        } else if (redWidth > greenWidth) {
          bidAskColor = 'red';
        } else if (greenWidth > redWidth) {
          bidAskColor = 'green';
        }
      }

      data.push({
        date: formattedDate,
        oi: isNaN(oi) ? 0 : oi,
        bidAsk: bidAskVal,
        redWidth: parseFloat(redWidth.toFixed(2)),
        greenWidth: parseFloat(greenWidth.toFixed(2)),
        color: bidAskColor
      });
    }

    return data.reverse();
  }, contractId);

  if (!history) {
    throw new Error("Failed to extract table data");
  }

  const outObj = {
    contractId,
    history: history.map(row => ({
      date: row.date,
      oi: row.oi,
      bidAsk: row.bidAsk,
      redWidth: row.redWidth,
      greenWidth: row.greenWidth,
      color: row.color
    }))
  };

  const outDir = getCacheDir(cacheUwDir, contractId);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const outPath = path.join(outDir, `${contractId}.json`);
  fs.writeFileSync(outPath, JSON.stringify(outObj, null, 2), 'utf8');
}

function findClosestIndex(strikesList, target) {
  let minDiff = Infinity;
  let index = -1;
  for (let i = 0; i < strikesList.length; i++) {
    const diff = Math.abs(strikesList[i] - target);
    if (diff < minDiff) {
      minDiff = diff;
      index = i;
    }
  }
  return index;
}

async function run() {
  const tickers = ['SPY', 'QQQ'];
  let queue = [];

  for (const ticker of tickers) {
    const tickerDir = path.join(cacheUwDir, ticker);
    if (!fs.existsSync(tickerDir)) {
      console.log(`Directory for ${ticker} does not exist in cache, skipping.`);
      continue;
    }

    const expiries = fs.readdirSync(tickerDir).filter(name => {
      return fs.statSync(path.join(tickerDir, name)).isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(name);
    });

    for (const expiry of expiries) {
      const expiryDir = path.join(tickerDir, expiry);
      const files = fs.readdirSync(expiryDir).filter(f => f.endsWith('.json'));
      
      if (files.length === 0) continue;

      // Detect minimum and maximum strikes currently in cache
      let strikesInCache = [];
      for (const file of files) {
        // e.g. SPY260608C00745000.json
        const match = file.match(/[CP](\d{8})\.json$/);
        if (match) {
          const strike = parseInt(match[1], 10) / 1000;
          strikesInCache.push(strike);
        }
      }

      if (strikesInCache.length === 0) continue;

      const currentMin = Math.min(...strikesInCache);
      const currentMax = Math.max(...strikesInCache);

      // Fetch real strikes from Yahoo
      console.log(`Fetching Yahoo strikes for ${ticker} ${expiry}...`);
      let yahooData;
      try {
        yahooData = await getYahooData(ticker, expiry);
      } catch (err) {
        console.error(`Failed to fetch Yahoo strikes for ${ticker} ${expiry}: ${err.message}`);
        continue;
      }

      const yahooStrikes = Array.from(new Set(yahooData.calls.concat(yahooData.puts).map(c => c.strike))).sort((a, b) => a - b);
      if (yahooStrikes.length === 0) {
        console.log(`No Yahoo strikes found for ${ticker} ${expiry}, skipping.`);
        continue;
      }

      const minIdx = findClosestIndex(yahooStrikes, currentMin);
      const maxIdx = findClosestIndex(yahooStrikes, currentMax);

      const newMinIdx = Math.max(0, minIdx - 10);
      const newMaxIdx = Math.min(yahooStrikes.length - 1, maxIdx + 10);

      const expandedMin = yahooStrikes[newMinIdx];
      const expandedMax = yahooStrikes[newMaxIdx];

      // Form list of missing contract IDs in the expanded range
      const yy = expiry.substring(2, 4);
      const mm = expiry.substring(5, 7);
      const dd = expiry.substring(8, 10);
      const expFormatted = yy + mm + dd;

      let newContractsCount = 0;
      let expQueue = [];

      for (let i = newMinIdx; i <= newMaxIdx; i++) {
        const strike = yahooStrikes[i];
        const strikeFormatted = String(Math.round(strike * 1000)).padStart(8, '0');

        const callContract = `${ticker}${expFormatted}C${strikeFormatted}`;
        const putContract = `${ticker}${expFormatted}P${strikeFormatted}`;

        const callPath = path.join(expiryDir, `${callContract}.json`);
        const putPath = path.join(expiryDir, `${putContract}.json`);

        if (!fs.existsSync(callPath)) {
          expQueue.push({ contractId: callContract, expiry, strike });
          newContractsCount++;
        }
        if (!fs.existsSync(putPath)) {
          expQueue.push({ contractId: putContract, expiry, strike });
          newContractsCount++;
        }
      }

      console.log(`\nTicker: ${ticker}`);
      console.log(`Expiration: ${expiry}`);
      console.log(`Current Range: ${currentMin}–${currentMax}`);
      console.log(`Expanded Range: ${expandedMin}–${expandedMax}`);
      console.log(`New Contracts: ${newContractsCount} nuevos\n`);

      if (expQueue.length > 0) {
        queue = queue.concat(expQueue);
      }
    }
  }

  if (queue.length === 0) {
    console.log("No new missing contracts found in the expanded range. Done.");
    return;
  }

  console.log(`Queue generated with ${queue.length} contracts to capture.`);

  // Open browser (1 time, 1 context, 1 page)
  console.log("Launching browser...");
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--start-maximized',
      '--disable-features=Translate'
    ]
  });

  const context = fs.existsSync(STATE_FILE)
    ? await browser.newContext({ viewport: null, storageState: STATE_FILE })
    : await browser.newContext({ viewport: null });
  
  const page = await context.newPage();

  // Verify session login for fsuar813@gmail.com
  console.log("Checking if user fsuar813@gmail.com is logged in...");
  async function checkUserLoggedIn(p) {
    try {
      await p.goto("https://unusualwhales.com/settings", { waitUntil: "networkidle", timeout: 20000 });
      const html = await p.content();
      if (html.toLowerCase().includes("fsuar813@gmail.com")) {
        return true;
      }
    } catch (e) {
      console.log("Settings page check failed/timed out, checking homepage fallback...");
    }
    try {
      await p.goto("https://unusualwhales.com/", { waitUntil: "networkidle", timeout: 20000 });
      const html = await p.content();
      return html.toLowerCase().includes("fsuar813@gmail.com");
    } catch (e) {
      return false;
    }
  }

  let isLoggedIn = await checkUserLoggedIn(page);
  
  if (!isLoggedIn) {
    console.log("User fsuar813@gmail.com is NOT logged in. Attempting automatic login...");
    await page.goto('https://unusualwhales.com/login', { waitUntil: 'networkidle', timeout: 30000 });
    console.log(`Inserting credentials for: ${process.env.UW_EMAIL}`);
    try {
      const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="@"], input[placeholder*="email"], input[placeholder*="Address"]').first();
      const passwordInput = page.locator('input[type="password"], input[name="password"], input[placeholder*="password"]').first();

      await emailInput.waitFor({ state: 'visible', timeout: 15000 });
      await emailInput.fill(process.env.UW_EMAIL);
      await passwordInput.fill(process.env.UW_PASSWORD);
      
      const loginButton = page.getByRole('button', { name: 'Sign in', exact: true });
      await loginButton.click();
      
      console.log("Submitting login form... Waiting for redirect...");
      await page.waitForURL('**/unusualwhales.com/**', { timeout: 20000 });
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(3000); 

      await context.storageState({ path: STATE_FILE });
      console.log(`Session state updated and saved to ${STATE_FILE}`);
      
      isLoggedIn = await checkUserLoggedIn(page);
      if (!isLoggedIn) {
        throw new Error("Email still not found after login attempt");
      }
    } catch (loginErr) {
      console.error("\n==================================================================");
      console.error("ERROR: Automatic login failed!", loginErr.message);
      console.error("==================================================================\n");
      await browser.close();
      process.exit(1);
    }
  }
  console.log("Session verified! User fsuar813@gmail.com is logged in.");

  // Process the missing contracts queue
  let errors = [];
  if (fs.existsSync(errorsFile)) {
    try {
      errors = JSON.parse(fs.readFileSync(errorsFile, 'utf8'));
    } catch (e) {
      errors = [];
    }
  }

  const startTime = Date.now();
  let processCount = 0;

  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    processCount++;
    const progress = `${i + 1}/${queue.length}`;
    
    // Calculate ETA
    const elapsed = Date.now() - startTime;
    const avgTimePerContract = processCount > 1 ? elapsed / (processCount - 1) : 4000;
    const remaining = queue.length - i;
    const etaMs = remaining * avgTimePerContract;
    const etaMin = Math.round(etaMs / 60000);
    const etaStr = `${etaMin}m`;

    console.log(`Processing: Expiry: ${item.expiry} | Strike: ${item.strike} | Contract: ${item.contractId} | Progress: ${progress} | ETA: ${etaStr}`);

    try {
      await fetchContract(page, item.contractId);
      await page.waitForTimeout(300);

      if (processCount % 20 === 0) {
        console.log("Waiting 3s to prevent rate limits...");
        await page.waitForTimeout(3000);
      }
    } catch (err) {
      console.error(`Error processing ${item.contractId}:`, err.message);
      errors.push({
        contractId: item.contractId,
        error: err.message,
        timestamp: new Date().toISOString()
      });
      fs.writeFileSync(errorsFile, JSON.stringify(errors, null, 2), 'utf8');
    }
  }

  await browser.close();
  console.log("Execution finished. Browser closed.");
}

run().catch(console.error);
