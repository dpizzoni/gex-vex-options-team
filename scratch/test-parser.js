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
  
  const history = await page.evaluate(() => {
    // Find the table that contains "Historical Volume" in its context or headers, or just table index 1
    const tables = Array.from(document.querySelectorAll('table'));
    if (tables.length < 2) return { error: "Not enough tables found: " + tables.length };
    
    // Table 1 is the historical volume table
    const table = tables[1];
    const ths = Array.from(table.querySelectorAll('th')).map(th => th.textContent.trim().toLowerCase());
    
    const dateIdx = ths.indexOf('date') !== -1 ? ths.indexOf('date') : 0;
    const oiIdx = ths.indexOf('oi') !== -1 ? ths.indexOf('oi') : 2;
    const bidAskIdx = ths.indexOf('bid/ask') !== -1 ? ths.indexOf('bid/ask') : 7;
    
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    const data = [];
    
    for (const tr of rows) {
      const tds = Array.from(tr.querySelectorAll('td'));
      if (tds.length <= Math.max(dateIdx, oiIdx, bidAskIdx)) continue;
      
      const dateText = tds[dateIdx].textContent.trim();
      const oiText = tds[oiIdx].textContent.replace(/,/g, '').trim();
      const oi = parseInt(oiText, 10);
      
      const bidAskTd = tds[bidAskIdx];
      const redDiv = bidAskTd.querySelector('div[class*="rose"], div[class*="red"]');
      const greenDiv = bidAskTd.querySelector('div[class*="emerald"], div[class*="green"]');
      
      const redValStr = redDiv ? redDiv.textContent.trim() : '';
      const greenValStr = greenDiv ? greenDiv.textContent.trim() : '';
      
      let bidAskVal = 0.5;
      let bidAskColor = 'unknown';
      
      if (redValStr && redValStr.includes('%')) {
        bidAskVal = parseFloat(redValStr.replace('%', '')) / 100;
        bidAskColor = 'red';
      } else if (greenValStr && greenValStr.includes('%')) {
        bidAskVal = parseFloat(greenValStr.replace('%', '')) / 100;
        bidAskColor = 'green';
      } else {
        const cellText = bidAskTd.textContent.trim();
        if (cellText.includes('%')) {
          bidAskVal = parseFloat(cellText.replace('%', '')) / 100;
          if (bidAskTd.innerHTML.includes('rose') || bidAskTd.innerHTML.includes('red')) {
            bidAskColor = 'red';
          } else if (bidAskTd.innerHTML.includes('emerald') || bidAskTd.innerHTML.includes('green')) {
            bidAskColor = 'green';
          }
        }
      }
      
      data.push({
        date: dateText,
        oi: isNaN(oi) ? 0 : oi,
        bidAsk: bidAskVal,
        color: bidAskColor
      });
    }
    
    return {
      headers: ths,
      rowsCount: rows.length,
      data: data.reverse()
    };
  });
  
  console.log("Parse results:", JSON.stringify(history, null, 2));
  
  await browser.close();
}

test();
