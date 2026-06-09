const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const filePath = path.join(__dirname, '..', 'cache', 'html', 'SPY260608C00745000.html');
const htmlContent = fs.readFileSync(filePath, 'utf8');
const dom = new JSDOM(htmlContent);
const document = dom.window.document;

const allTables = Array.from(document.querySelectorAll('table'));
const table = allTables.find(t => {
  const ths = Array.from(t.querySelectorAll('th')).map(th => th.textContent.trim().toLowerCase());
  return ths.includes('date') && ths.includes('oi') && ths.includes('bid/ask');
});

const ths = Array.from(table.querySelectorAll('th')).map(th => th.textContent.trim().toLowerCase());
const dateIdx = ths.indexOf('date');
const bidAskIdx = ths.indexOf('bid/ask');

const rows = Array.from(table.querySelectorAll('tbody tr'));
rows.forEach(tr => {
  const tds = Array.from(tr.querySelectorAll('td'));
  if(tds.length <= bidAskIdx) return;
  const dateText = tds[dateIdx].textContent.trim();
  const bidAskTd = tds[bidAskIdx];
  const left = bidAskTd.querySelector('.left-side');
  const mid = bidAskTd.querySelector('.mid-side');
  const right = bidAskTd.querySelector('.right-side');
  
  let leftW = left ? parseFloat(left.style.width) || 0 : 0;
  let leftC = left ? left.style.backgroundColor : '';
  let midW = mid ? parseFloat(mid.style.width) || 0 : 0;
  let midC = mid ? mid.style.backgroundColor : '';
  let rightW = right ? parseFloat(right.style.width) || 0 : 0;
  let rightC = right ? right.style.backgroundColor : '';
  
  console.log(`CALL ${dateText} - L(${leftC}): ${leftW.toFixed(1)}%, M(${midC}): ${midW.toFixed(1)}%, R(${rightC}): ${rightW.toFixed(1)}%`);
});
