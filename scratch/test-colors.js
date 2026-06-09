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
    const table = tables[1];
    if (!table) return { error: "Table 1 not found" };
    
    const ths = Array.from(table.querySelectorAll('th')).map(th => th.textContent.trim().toLowerCase());
    const bidAskIdx = ths.indexOf('bid/ask');
    const dateIdx = ths.indexOf('date');
    
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    
    return rows.map((tr, rIdx) => {
      const tds = Array.from(tr.querySelectorAll('td'));
      const bidAskTd = tds[bidAskIdx];
      const dateTd = tds[dateIdx];
      
      const redDiv = bidAskTd.querySelector('div[class*="rose"], div[class*="red"]');
      const greenDiv = bidAskTd.querySelector('div[class*="emerald"], div[class*="green"]');
      
      const redValStr = redDiv ? redDiv.textContent.trim() : '';
      const greenValStr = greenDiv ? greenDiv.textContent.trim() : '';
      
      let bidAskVal = 0.5;
      let bidAskColor = 'unknown';
      let branch = '';
      
      if (redValStr && redValStr.includes('%')) {
        bidAskVal = parseFloat(redValStr.replace('%', '')) / 100;
        bidAskColor = 'red';
        branch = 'redDiv branch';
      } else if (greenValStr && greenValStr.includes('%')) {
        bidAskVal = parseFloat(greenValStr.replace('%', '')) / 100;
        bidAskColor = 'green';
        branch = 'greenDiv branch';
      } else {
        const cellText = bidAskTd.textContent.trim();
        if (cellText.includes('%')) {
          bidAskVal = parseFloat(cellText.replace('%', '')) / 100;
          if (bidAskTd.innerHTML.includes('rose') || bidAskTd.innerHTML.includes('red')) {
            bidAskColor = 'red';
            branch = 'fallback rose/red';
          } else if (bidAskTd.innerHTML.includes('emerald') || bidAskTd.innerHTML.includes('green')) {
            bidAskColor = 'green';
            branch = 'fallback emerald/green';
          } else {
            branch = 'fallback no color match';
          }
        } else {
          branch = 'no % at all';
        }
      }
      
      return {
        row: rIdx,
        date: dateTd ? dateTd.textContent.trim() : 'N/A',
        redDivExists: !!redDiv,
        greenDivExists: !!greenDiv,
        redValStr,
        greenValStr,
        bidAskVal,
        bidAskColor,
        branch
      };
    });
  });
  
  console.log("Colors Debug:", JSON.stringify(debugInfo, null, 2));
  
  await browser.close();
}

test();
