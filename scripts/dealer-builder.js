const fs = require('fs');
const path = require('path');
const { getCacheDir } = require('./cache-resolver');

const uwDir = path.join(__dirname, '..', 'cache', 'uw');
const dealerDir = path.join(__dirname, '..', 'cache', 'dealer');

function getAllJsonFiles(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getAllJsonFiles(filePath));
    } else if (file.endsWith('.json') && file !== 'metadata.json') {
      results.push(filePath);
    }
  }
  return results;
}

function buildDealer(contractId, history) {
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
      const absDelta = Math.abs(delta);
      buy -= absDelta * buyPct;
      sell -= absDelta * sellPct;
    }

    buy = Math.max(0, buy);
    sell = Math.max(0, sell);
  }

  const inventory = buy + sell;
  const bias = inventory > 0 ? (buy - sell) / inventory : 0;
  const lastRecord = history[history.length - 1];

  return {
    buy: Math.round(buy),
    sell: Math.round(sell),
    bias: Number(bias.toFixed(3)),
    lastOI: lastRecord ? lastRecord.oi : 0,
    lastDate: lastRecord ? lastRecord.date : ""
  };
}

function run() {
  if (!fs.existsSync(uwDir)) {
    fs.mkdirSync(uwDir, { recursive: true });
  }
  if (!fs.existsSync(dealerDir)) {
    fs.mkdirSync(dealerDir, { recursive: true });
  }

  const filePaths = getAllJsonFiles(uwDir);
  console.log('contracts found:\n' + filePaths.map(f => path.basename(f).replace('.json', '')).join('\n'));

  for (const filePath of filePaths) {
    const file = path.basename(filePath);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const contractId = data.contractId || file.replace('.json', '');
      const history = data.history || [];

      console.log('processing:\n' + contractId);
      console.log('history length:\n' + history.length);

      if (history.length < 2) {
        console.log('SKIP\nreason:\nINSUFFICIENT_HISTORY');
        console.log('history empty');
        continue;
      }

      let isValid = true;
      for (const row of history) {
        console.log(`date: ${row.date} oi: ${row.oi} bidAsk: ${row.bidAsk} color: ${row.color}`);
        if (row.date === undefined || row.oi === undefined || row.bidAsk === undefined || row.color === undefined) {
          console.log('INVALID_ROW');
          isValid = false;
          break;
        }
      }
      if (!isValid) {
        console.log('parse failed');
        continue;
      }

      const result = buildDealer(contractId, history);

      console.log(`building:\n  ${contractId}`);
      console.log(`result:\n  buy=${result.buy}\n  sell=${result.sell}\n  bias=${result.bias}`);

      const outObj = {
        contractId: contractId,
        buy: result.buy,
        sell: result.sell,
        bias: result.bias,
        lastOI: result.lastOI,
        lastDate: result.lastDate
      };

      const outDir = getCacheDir(dealerDir, contractId);
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }

      const outPath = path.join(outDir, `${contractId}.json`);
      fs.writeFileSync(outPath, JSON.stringify(outObj, null, 2), 'utf8');
      console.log(`SAVED:\n${outPath}\nsaved successfully`);

    } catch (err) {
      console.log('parse failed');
      console.error(`Error processing ${file}:`, err);
    }
  }
}

run();
