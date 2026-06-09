const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'auth_state.json');
const debugDir = path.join(__dirname, '..', 'debug');

async function test() {
  if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
  
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--start-maximized',
      '--disable-features=Translate'
    ]
  });
  
  let context;
  if (fs.existsSync(STATE_FILE)) {
    console.log("Loading existing state...");
    context = await browser.newContext({ viewport: null, storageState: STATE_FILE });
  } else {
    console.log("No auth state found!");
    context = await browser.newContext({ viewport: null });
  }
  
  const page = await context.newPage();
  const url = 'https://unusualwhales.com/flow/option_chains?chain=SPY260608C00745000';
  console.log(`Navigating to ${url}...`);
  
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  } catch (e) {
    console.log("Navigation timeout or error, waiting 5 more seconds...");
    await page.waitForTimeout(5000);
  }
  
  await page.screenshot({ path: path.join(debugDir, 'test-navigation.png') });
  console.log("Saved test-navigation.png");
  
  // Let's log some details of elements on the page
  const title = await page.title();
  console.log("Page title:", title);
  
  const hasTable = await page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table'));
    console.log(`Found ${tables.length} tables`);
    const headers = Array.from(document.querySelectorAll('*')).filter(el => el.textContent && el.textContent.includes('Historical Volume'));
    return {
      tableCount: tables.length,
      headersFound: headers.map(h => h.tagName + ': ' + h.textContent.substring(0, 100)),
      bodyHtmlSnippet: document.body.innerHTML.substring(0, 1000)
    };
  });
  
  console.log("Has table info:", JSON.stringify(hasTable, null, 2));
  
  await browser.close();
}

test();
