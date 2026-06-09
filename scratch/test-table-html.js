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
  
  const debugInfo = await page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table'));
    const table = tables[1]; // Or find the correct one
    
    if (!table) return { error: "Table 1 not found" };
    
    const ths = Array.from(table.querySelectorAll('th')).map(th => th.textContent.trim().toLowerCase());
    const bidAskIdx = ths.indexOf('bid/ask');
    const dateIdx = ths.indexOf('date');
    
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    
    return rows.map((tr, rIdx) => {
      const tds = Array.from(tr.querySelectorAll('td'));
      const bidAskTd = tds[bidAskIdx];
      const dateTd = tds[dateIdx];
      return {
        row: rIdx,
        date: dateTd ? dateTd.textContent.trim() : 'N/A',
        bidAskHeaderIndex: bidAskIdx,
        bidAskHtml: bidAskTd ? bidAskTd.innerHTML : 'N/A',
        bidAskText: bidAskTd ? bidAskTd.textContent.trim() : 'N/A'
      };
    });
  });
  
  console.log("Debug Bid/Ask HTML:", JSON.stringify(debugInfo, null, 2));
  
  await browser.close();
}

test();
