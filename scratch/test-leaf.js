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
    // Find all elements containing "Historical Volume / OI"
    const candidates = Array.from(document.querySelectorAll('*')).filter(el => {
      if (!el.textContent || !el.textContent.includes('Historical Volume / OI')) return false;
      const children = Array.from(el.children);
      const hasChildWithText = children.some(child => child.textContent && child.textContent.includes('Historical Volume / OI'));
      return !hasChildWithText;
    });
    
    const header = candidates[0];
    if (!header) {
      return { error: "No header candidate found" };
    }
    
    // Find table
    let table = null;
    let node = header;
    const path = [];
    while (node && node !== document.body) {
      path.push(node.tagName + (node.className ? '.' + node.className.split(' ').join('.') : ''));
      
      let sibling = node.nextElementSibling;
      while (sibling) {
        table = sibling.querySelector('table') || (sibling.tagName === 'TABLE' ? sibling : null);
        if (table) break;
        sibling = sibling.nextElementSibling;
      }
      if (table) break;
      node = node.parentElement;
    }
    
    return {
      headerFound: {
        tagName: header.tagName,
        className: header.className,
        text: header.textContent
      },
      traversalPath: path,
      tableFound: !!table,
      tableHeaders: table ? Array.from(table.querySelectorAll('th')).map(th => th.textContent.trim()) : [],
      tableRowsCount: table ? table.querySelectorAll('tbody tr').length : 0
    };
  });
  
  console.log("Debug Info:", JSON.stringify(debugInfo, null, 2));
  
  await browser.close();
}

test();
