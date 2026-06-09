require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { getCacheDir } = require('./cache-resolver');

const STATE_FILE = path.join(__dirname, '..', 'auth_state.json');
const cacheUwDir = path.join(__dirname, '..', 'cache', 'uw');
const queueFile = path.join(__dirname, '..', 'capture_queue.json');
const stateFile = path.join(__dirname, '..', 'capture_state.json');
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
    // Silently ignore or log minor error
    console.log(`Note: Expand button check failed: ${err.message}`);
  }
}

async function fetchContract(page, contractId, isDaily = false) {
  const chainUrl = `https://unusualwhales.com/flow/option_chains?chain=${contractId}`;
  
  const outDir = getCacheDir(cacheUwDir, contractId);
  const outPath = path.join(outDir, `${contractId}.json`);
  const fileExists = fs.existsSync(outPath);
  const shouldBeIncremental = isDaily && fileExists;

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

  // Expand table only if not incremental
  if (!shouldBeIncremental) {
    await expandTable(page);
  }

  // Extract data with page.evaluate (EXACT duplication of uw-parse extraction logic)
  const history = await page.evaluate(([cId, isInc]) => {
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
    const rowsToProcess = isInc ? rows.slice(0, 1) : rows;
    const data = [];
    
    let currentYear = expYear;
    let lastMonth = null;
    
    for (let i = 0; i < rowsToProcess.length; i++) {
      const tr = rowsToProcess[i];
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
  }, [contractId, shouldBeIncremental]);

  if (!history || history.length === 0) {
    throw new Error("Failed to extract table data");
  }

  let finalHistory = [];
  if (shouldBeIncremental) {
    const existingData = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    const existingHistory = existingData.history || [];
    const newRow = history[0];

    if (existingHistory.length > 0) {
      const lastIndex = existingHistory.length - 1;
      const lastRow = existingHistory[lastIndex];

      if (newRow.date > lastRow.date) {
        existingHistory.push(newRow);
      } else if (newRow.date === lastRow.date) {
        existingHistory[lastIndex] = newRow;
      } else {
        console.log(`Incremental Warning: Scraped date ${newRow.date} is older than last cached date ${lastRow.date} for ${contractId}. Skipping.`);
      }
    } else {
      existingHistory.push(newRow);
    }
    finalHistory = existingHistory;
  } else {
    finalHistory = history;
  }

  const outObj = {
    contractId,
    history: finalHistory.map(row => ({
      date: row.date,
      oi: row.oi,
      bidAsk: row.bidAsk,
      redWidth: row.redWidth,
      greenWidth: row.greenWidth,
      color: row.color
    }))
  };

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  fs.writeFileSync(outPath, JSON.stringify(outObj, null, 2), 'utf8');
}

async function run() {
  const args = process.argv.slice(2);
  const tickerArg = args.find(a => !a.startsWith('--'));
  const resume = process.argv.includes('--resume');
  const isDaily = process.argv.includes('--daily');

  if (isDaily) {
    console.log("Daily incremental update mode active.");
  }

  let plan = { tickers: [], expirations: 10, strikesEachSide: 10, enabled: false };
  const planPath = path.join(__dirname, '..', 'config', 'capture_plan.json');
  if (fs.existsSync(planPath)) {
    plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  }

  let tickersToProcess = [];
  if (tickerArg) {
    tickersToProcess = [tickerArg.toUpperCase()];
  } else if (plan.enabled && plan.tickers && plan.tickers.length > 0) {
    tickersToProcess = plan.tickers.map(t => t.toUpperCase());
    console.log(`\nPlan Loaded\nTickers:\n${plan.tickers.length}\nExpirations:\n${plan.expirations}\nStrikes:\n${plan.strikesEachSide * 2 + 1}\n`);
  } else {
    console.error("Usage: npm run uw:window <ticker> [--resume]\nOr enable config/capture_plan.json");
    process.exit(1);
  }

  let queue = [];
  let state = { lastProcessed: null, completed: [] };
  let spotPrice = 0;

  if (resume && fs.existsSync(queueFile) && fs.existsSync(stateFile)) {
    console.log("Resuming queue from capture_queue.json...");
    queue = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
    state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    
    // Fetch current spot price for logging of first ticker
    if (tickersToProcess.length > 0) {
      try {
        const baseData = await getYahooData(tickersToProcess[0]);
        spotPrice = baseData.spot;
      } catch (e) {
        console.log("Could not refresh spot price for resume logging, using default 0.");
      }
    }
  } else {
    queue = [];
    for (const ticker of tickersToProcess) {
      console.log(`Initializing new queue for ${ticker} from Yahoo Finance...`);
      
      // Step 1: Query Yahoo data
      const baseData = await getYahooData(ticker);
      const currentSpot = baseData.spot;
      if (ticker === tickersToProcess[0]) spotPrice = currentSpot;
      const expirations = baseData.expirations;
      
      // Step 2: Take N expirations
      let expCount = (!plan.enabled) ? 10 : plan.expirations;
      if (ticker === 'SPY' || ticker === 'QQQ') {
        expCount = 5;
      }
      const targetExpirations = expirations.slice(0, expCount);
      console.log(`Found spot price: $${currentSpot.toFixed(2)}. Processing first ${expCount} expirations:`, targetExpirations);

      // Step 3-5: Generate queue
      for (const exp of targetExpirations) {
        console.log(`Fetching strikes for expiration: ${exp}...`);
        const expData = await getYahooData(ticker, exp);
        
        const strikes = Array.from(new Set(expData.calls.map(c => c.strike))).sort((a, b) => a - b);
        if (strikes.length === 0) continue;

        // Find ATM strike index
        let minDiff = Infinity;
        let atmIndex = -1;
        for (let i = 0; i < strikes.length; i++) {
          const diff = Math.abs(strikes[i] - currentSpot);
          if (diff < minDiff) {
            minDiff = diff;
            atmIndex = i;
          }
        }

        // Step 4: Window of strikes
        const strikesEachSide = (!plan.enabled) ? 20 : plan.strikesEachSide;
        const windowStrikes = [];
        const startIdx = atmIndex - strikesEachSide;
        const endIdx = atmIndex + strikesEachSide;
        for (let i = startIdx; i <= endIdx; i++) {
          if (i >= 0 && i < strikes.length) {
            windowStrikes.push(strikes[i]);
          }
        }

        // Step 5: Format and add contracts to queue
        const yy = exp.substring(2, 4);
        const mm = exp.substring(5, 7);
        const dd = exp.substring(8, 10);
        const expFormatted = yy + mm + dd;

        for (const strike of windowStrikes) {
          const strikeFormatted = String(Math.round(strike * 1000)).padStart(8, '0');
          
          queue.push({
            contractId: `${ticker}${expFormatted}C${strikeFormatted}`,
            expiry: exp,
            strike: strike
          });
          queue.push({
            contractId: `${ticker}${expFormatted}P${strikeFormatted}`,
            expiry: exp,
            strike: strike
          });
        }
      }
    }

    fs.writeFileSync(queueFile, JSON.stringify(queue, null, 2), 'utf8');
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
    console.log(`Queue generated with ${queue.length} contracts and saved to capture_queue.json`);
  }

  // Step 6: Open browser
  console.log("Launching browser...");
  const browser = await chromium.launch({
    headless: process.env.CI ? true : false,
    args: [
      '--start-maximized',
      '--disable-features=Translate'
    ]
  });

  const contextOptions = {
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'es-AR'
  };
  if (fs.existsSync(STATE_FILE)) {
    contextOptions.storageState = STATE_FILE;
  }
  const context = await browser.newContext(contextOptions);

  // Stealth: bypass navigator.webdriver detection
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });
  
  const page = await context.newPage();

  // Verify session login for fsuar813@gmail.com
  console.log("Checking if user is logged in...");
  const userEmail = process.env.UW_EMAIL ? process.env.UW_EMAIL.toLowerCase() : "fsuar813@gmail.com";
  
  async function checkUserLoggedIn(p) {
    try {
      await p.goto("https://unusualwhales.com/settings", { waitUntil: "networkidle", timeout: 20000 });
      const html = await p.content();
      if (html.toLowerCase().includes(userEmail)) return true;
    } catch (e) {
      console.log("Settings page check failed/timed out, checking homepage fallback...");
    }
    try {
      await p.goto("https://unusualwhales.com/", { waitUntil: "networkidle", timeout: 20000 });
      const html = await p.content();
      return html.toLowerCase().includes(userEmail);
    } catch (e) {
      return false;
    }
  }

  async function ensureLoggedIn(p, ctx) {
    let loggedIn = await checkUserLoggedIn(p);
    if (!loggedIn) {
      console.log(`User ${userEmail} is NOT logged in. Attempting automatic login...`);
      await p.goto('https://unusualwhales.com/login', { waitUntil: 'networkidle', timeout: 30000 });
      try {
        const emailInput = p.locator('input[type="email"], input[name="email"], input[placeholder*="@"], input[placeholder*="email"], input[placeholder*="Address"]').first();
        const passwordInput = p.locator('input[type="password"], input[name="password"], input[placeholder*="password"]').first();

        await emailInput.waitFor({ state: 'visible', timeout: 15000 });
        await emailInput.fill(process.env.UW_EMAIL);
        await passwordInput.fill(process.env.UW_PASSWORD);
        
        const loginButton = p.getByRole('button', { name: 'Sign in', exact: true });
        await loginButton.click();
        
        console.log("Submitting login form... Waiting for redirect...");
        await p.waitForURL('**/unusualwhales.com/**', { timeout: 20000 });
        await p.waitForLoadState('networkidle');
        await p.waitForTimeout(3000); 

        await ctx.storageState({ path: STATE_FILE });
        console.log(`Session state updated and saved to ${STATE_FILE}`);
        
        loggedIn = await checkUserLoggedIn(p);
        if (!loggedIn) throw new Error("Email still not found after login attempt");
      } catch (loginErr) {
        console.error("\n==================================================================");
        console.error("ERROR: Automatic login failed!", loginErr.message);
        console.error("==================================================================\n");
        throw loginErr;
      }
    }
    console.log(`Session verified! User ${userEmail} is logged in.`);
  }

  try {
    await ensureLoggedIn(page, context);
  } catch (err) {
    await browser.close();
    process.exit(1);
  }

  // Load errors log
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
    if (state.completed.includes(item.contractId)) {
      continue;
    }

    processCount++;
    const progress = `${state.completed.length + 1}/${queue.length}`;
    
    // Calculate ETA
    const elapsed = Date.now() - startTime;
    const avgTimePerContract = processCount > 1 ? elapsed / (processCount - 1) : 4000; // default 4s estimate
    const remaining = queue.length - state.completed.length;
    const etaMs = remaining * avgTimePerContract;
    const etaMin = Math.round(etaMs / 60000);
    const etaStr = `${etaMin}m`;

    // Log Format: Spot Expiry Strike Contract Progress ETA
    console.log(`Spot: ${spotPrice.toFixed(2)} | Expiry: ${item.expiry} | Strike: ${item.strike} | Contract: ${item.contractId} | Progress: ${progress} | ETA: ${etaStr}`);

    try {
      await fetchContract(page, item.contractId, isDaily);
      
      // Update state
      state.completed.push(item.contractId);
      state.lastProcessed = item.contractId;
      
      // Checkpoint every 50 contracts
      if (processCount % 50 === 0) {
        fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
        console.log(`Checkpoint saved: ${state.completed.length} completed.`);
      }

      // Delay 300ms
      await page.waitForTimeout(300);

      // Delay 3s every 20 processed contracts
      if (processCount % 20 === 0) {
        console.log("Waiting 3s to prevent rate limits...");
        await page.waitForTimeout(3000);
      }

    } catch (err) {
      console.error(`Error processing ${item.contractId}:`, err.message);
      
      // Save debug screenshot
      try {
        const debugDir = path.join(__dirname, '..', 'debug');
        if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
        await page.screenshot({ path: path.join(debugDir, `error_${item.contractId}.png`), fullPage: true });
        console.log(`Saved debug screenshot for ${item.contractId}`);
      } catch (screenshotErr) {
        console.error("Failed to take debug screenshot:", screenshotErr.message);
      }
      
      // Check if we got logged out
      try {
        const stillLoggedIn = await checkUserLoggedIn(page);
        if (!stillLoggedIn) {
          console.log("⚠️ DETECTED LOGOUT DURING QUEUE. Attempting to recover session...");
          await ensureLoggedIn(page, context);
          console.log("✅ Session recovered. Retrying contract...");
          i--; // Retry current contract
          processCount--; // Adjust progress count
          continue; // Skip adding to errors
        }
      } catch (recoverErr) {
        console.error("Failed to recover session:", recoverErr.message);
      }

      errors.push({
        contractId: item.contractId,
        error: err.message,
        timestamp: new Date().toISOString()
      });
      fs.writeFileSync(errorsFile, JSON.stringify(errors, null, 2), 'utf8');
    }
  }

  // Save final state
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');

  try {
    const closePromise = browser.close();
    const timeoutPromise = new Promise(resolve => setTimeout(resolve, 5000));
    await Promise.race([closePromise, timeoutPromise]);
    console.log("Execution finished. Browser closed.");
  } catch (e) {
    console.error("Error closing browser:", e);
  } finally {
    process.exit(0);
  }
}

run().catch(err => {
  console.error("Unhandled execution error:", err);
  process.exit(1);
});
