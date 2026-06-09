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
  
  const buttons = await page.evaluate(() => {
    // Find the header SPAN
    const candidates = Array.from(document.querySelectorAll('*')).filter(el => {
      if (!el.textContent || !el.textContent.includes('Historical Volume / OI')) return false;
      const children = Array.from(el.children);
      const hasChildWithText = children.some(child => child.textContent && child.textContent.includes('Historical Volume / OI'));
      return !hasChildWithText;
    });
    const header = candidates[0];
    if (!header) return { error: "Header not found" };
    
    // Go up to the container
    let container = header.parentElement;
    while (container && !container.className.includes('rounded-md')) {
      container = container.parentElement;
    }
    
    if (!container) return { error: "Container not found" };
    
    // Find all buttons inside the container
    const btns = Array.from(container.querySelectorAll('button, a, div[role="button"]'));
    return btns.map(b => ({
      tagName: b.tagName,
      text: b.textContent.trim(),
      className: b.className,
      id: b.id
    }));
  });
  
  console.log("Buttons found in table container:", JSON.stringify(buttons, null, 2));
  
  await browser.close();
}

test();
