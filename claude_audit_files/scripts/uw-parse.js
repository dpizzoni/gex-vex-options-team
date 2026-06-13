const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const htmlDir = path.join(__dirname, '..', 'cache', 'html');
const uwDir = path.join(__dirname, '..', 'cache', 'uw');

function parseHtmlFile(filePath) {
  const contractId = path.basename(filePath, '.html');
  console.log(`parsing:\n${contractId}`);

  const match = contractId.match(/^([a-zA-Z]+)(\d{6})([CP])(\d{8})$/);
  const symbol = match ? match[1] : 'SPY';
  
  const expiryStr = contractId.substring(symbol.length, symbol.length + 6);
  const yy = expiryStr.substring(0, 2);
  const mm = expiryStr.substring(2, 4);
  const dd = expiryStr.substring(4, 6);

  const expYear = parseInt(`20${yy}`, 10);
  const expMonth = parseInt(mm, 10);
  const expDay = parseInt(dd, 10);

  const htmlContent = fs.readFileSync(filePath, 'utf8');
  const dom = new JSDOM(htmlContent);
  const document = dom.window.document;

  // Find the header text using leaf candidate logic
  const candidates = Array.from(document.querySelectorAll('*')).filter(el => {
    if (!el.textContent || !el.textContent.includes('Historical Volume / OI')) return false;
    const children = Array.from(el.children);
    const hasChildWithText = children.some(child => child.textContent && child.textContent.includes('Historical Volume / OI'));
    return !hasChildWithText;
  });
  
  const header = candidates[0];
  if (!header) {
    console.error(`Header 'Historical Volume / OI' not found in ${filePath}`);
    return;
  }
  
  // Find the nearest table following the header in DOM hierarchy
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
    // Fallback: look for a table that has a "Date" header
    const allTables = Array.from(document.querySelectorAll('table'));
    table = allTables.find(t => {
      const ths = Array.from(t.querySelectorAll('th')).map(th => th.textContent.trim().toLowerCase());
      return ths.includes('date') && ths.includes('oi') && ths.includes('bid/ask');
    });
  }

  if (!table) {
    console.error(`Table not found in ${filePath}`);
    return;
  }

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

    const isRedBarText = !!(redValStr && redValStr.includes('%'));

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
      color: bidAskColor,
      dateText: dateText
    });
  }

  const sortedData = data.reverse();

  // Print outputs for verification as expected
  sortedData.forEach(row => {
    console.log(row.dateText);
    console.log(row.color);
  });

  const outPath = path.join(uwDir, `${contractId}.json`);
  const outObj = {
    contractId: contractId,
    history: sortedData.map(row => ({
      date: row.date,
      oi: row.oi,
      bidAsk: row.bidAsk,
      redWidth: row.redWidth,
      greenWidth: row.greenWidth,
      color: row.color
    }))
  };

  fs.writeFileSync(outPath, JSON.stringify(outObj, null, 2), 'utf8');
  console.log(`rows:\n${sortedData.length}`);
  console.log(`saved:\n${outPath}`);
}

function run() {
  if (!fs.existsSync(uwDir)) fs.mkdirSync(uwDir, { recursive: true });

  const args = process.argv.slice(2);
  let filesToParse = [];

  if (args.length > 0) {
    // Parse specified contract IDs or HTML files
    args.forEach(arg => {
      let filePath = arg;
      if (!arg.endsWith('.html')) {
        filePath = path.join(htmlDir, `${arg}.html`);
      }
      if (fs.existsSync(filePath)) {
        filesToParse.push(filePath);
      } else {
        console.error(`File not found: ${filePath}`);
      }
    });
  } else {
    // Parse all files in htmlDir
    if (fs.existsSync(htmlDir)) {
      const files = fs.readdirSync(htmlDir).filter(f => f.endsWith('.html'));
      filesToParse = files.map(f => path.join(htmlDir, f));
    }
  }

  if (filesToParse.length === 0) {
    console.log("No HTML files found to parse.");
    console.log('finished');
    return;
  }

  filesToParse.forEach(parseHtmlFile);
  console.log('finished');
}

run();
