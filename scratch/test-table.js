const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'auth_state.json');

async function test() {
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--start-maximized',
      '--disable-features=Translate'
    ]
  });
  
  const context = await browser.newContext({ viewport: null, storageState: STATE_FILE });
  const page = await context.newPage();
  const url = 'https://unusualwhales.com/flow/option_chains?chain=SPY260608C00745000';
  
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  } catch (e) {
    console.log("Navigation timeout or error, waiting 5 more seconds...");
    await page.waitForTimeout(5000);
  }
  
  const tableData = await page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table'));
    return tables.map((t, idx) => {
      const ths = Array.from(t.querySelectorAll('th')).map(th => th.textContent.trim());
      const trs = Array.from(t.querySelectorAll('tbody tr'));
      const sampleRow = trs[0] ? Array.from(trs[0].querySelectorAll('td')).map(td => {
        return {
          text: td.textContent.trim(),
          html: td.innerHTML,
          className: td.className
        };
      }) : [];
      return {
        index: idx,
        headers: ths,
        rowCount: trs.length,
        sampleRow: sampleRow
      };
    });
  });
  
  console.log("Tables found:", JSON.stringify(tableData, null, 2));
  
  await browser.close();
}

test();
