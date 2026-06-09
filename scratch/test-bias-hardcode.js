const history = [
  { date: '2026-05-26', oi: 0, bidAsk: 0.98, color: 'red' },
  { date: '2026-05-27', oi: 1198, bidAsk: 0.69, color: 'green' },
  { date: '2026-05-28', oi: 1312, bidAsk: 0.56, color: 'green' },
  { date: '2026-05-29', oi: 1568, bidAsk: 0.49, color: 'unknown' },
  { date: '2026-06-01', oi: 1771, bidAsk: 0.71, color: 'green' },
  { date: '2026-06-02', oi: 2890, bidAsk: 0.84, color: 'green' },
  { date: '2026-06-03', oi: 4130, bidAsk: 0.77, color: 'red' },
  { date: '2026-06-04', oi: 4627, bidAsk: 0.62, color: 'green' },
  { date: '2026-06-05', oi: 5543, bidAsk: 0.44, color: 'red' }
];

let buy = 0;
let sell = 0;

for (let i = 0; i < history.length - 1; i++) {
  const currentOI = history[i].oi;
  const nextOI = history[i + 1].oi;
  const delta = nextOI - currentOI;
  if (delta === 0) continue;

  const record = history[i + 1];
  const color = record.color;
  const bidAsk = record.bidAsk;

  let buyPct = 0.5;
  let sellPct = 0.5;

  if (color === 'green') {
    buyPct = bidAsk;
    sellPct = 1 - bidAsk;
  } else if (color === 'red') {
    sellPct = bidAsk;
    buyPct = 1 - bidAsk;
  }

  if (delta > 0) {
    buy += delta * buyPct;
    sell += delta * sellPct;
  } else {
    buy -= Math.abs(delta) * buyPct;
    sell -= Math.abs(delta) * sellPct;
  }
}

buy = Math.max(0, buy);
sell = Math.max(0, sell);

const inventory = buy + sell;
const bias = inventory > 0 ? (buy - sell) / inventory : 0;
console.log(`buy: ${buy}, sell: ${sell}, bias: ${(bias*100).toFixed(1)}%`);
