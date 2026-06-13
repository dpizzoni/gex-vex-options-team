const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'auth_state.json');
const htmlDir = path.join(__dirname, '..', 'cache', 'html');
const debugDir = path.join(__dirname, '..', 'debug');

async function run() {
  const contractIds = process.argv.slice(2);
  if (contractIds.length === 0) {
    console.error("Usage: npm run uw:capture <contractId1> [contractId2] ...");
    console.log('finished');
    return;
  }

  if (!fs.existsSync(htmlDir)) fs.mkdirSync(htmlDir, { recursive: true });
  if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });

  // Headless: false as requested
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--start-maximized',
      '--disable-features=Translate'
    ]
  });
  
  try {
    let context;
    if (fs.existsSync(STATE_FILE)) {
      context = await browser.newContext({ viewport: null, storageState: STATE_FILE });
    } else {
      context = await browser.newContext({ viewport: null });
    }

    const page = await context.newPage();

    for (const contractId of contractIds) {
      console.log(`opening:\n${contractId}`);
      const chainUrl = `https://unusualwhales.com/flow/option_chains?chain=${contractId}`;
      
      // Navigate directly to the chain URL
      try {
        console.log(`Navigating directly to: ${chainUrl}`);
        await page.goto(chainUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      } catch (err) {
        console.error(`Direct navigation failed for ${contractId}`, err);
      }

      try {
        // Wait for the table header to be present on the page
        await page.waitForFunction(() => {
          const hasText = document.body.innerText.includes("Historical Volume / OI");
          if (!hasText) return false;
          // Also ensure at least one table row has loaded
          const tables = Array.from(document.querySelectorAll('table'));
          const targetTable = tables.find(t => {
            const ths = Array.from(t.querySelectorAll('th')).map(th => th.textContent.trim().toLowerCase());
            return ths.includes('date') && ths.includes('oi') && ths.includes('bid/ask');
          });
          if (!targetTable) return false;
          const rows = targetTable.querySelectorAll('tbody tr');
          return rows.length > 0;
        }, { timeout: 10000 });
      } catch (err) {
        const errPath = path.join(debugDir, `${contractId}-error.png`);
        await page.screenshot({ path: errPath });
        console.log(`Table or rows not found for ${contractId}. Saved screenshot to ${errPath}`);
        continue;
      }

      // Capture outerHTML
      const htmlContent = await page.content();
      const outHtmlPath = path.join(htmlDir, `${contractId}.html`);
      fs.writeFileSync(outHtmlPath, htmlContent, 'utf8');
      console.log(`captured:\n${contractId}.html`);
    }

  } finally {
    await browser.close();
    console.log('browser closed');
    console.log('finished');
  }
}

run();
