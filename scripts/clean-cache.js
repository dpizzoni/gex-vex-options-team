const fs = require('fs');
const path = require('path');

async function getYahooData(ticker) {
  try {
    const res = await fetch(`http://127.0.0.1:8000/api/options?symbol=${ticker}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    const fallbackRes = await fetch(`http://127.0.0.1:3002/api/options?symbol=${ticker}`);
    return await fallbackRes.json();
  }
}

async function main() {
  const planPath = path.join(__dirname, '..', 'config', 'capture_plan.json');
  let plan = { tickers: ['SPY', 'QQQ'], expirations: 10 };
  if (fs.existsSync(planPath)) {
    plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  }

  const tickers = plan.tickers || [];
  
  for (const ticker of tickers) {
    console.log(`\nProcessing cleanup for ${ticker}...`);
    const data = await getYahooData(ticker);
    if (!data.expirations || data.expirations.length === 0) {
      console.log(`Could not get expirations for ${ticker}`);
      continue;
    }
    
    let expCount = plan.expirations;
    if (ticker === 'SPY' || ticker === 'QQQ') expCount = 5;
    
    const keepDates = data.expirations.slice(0, expCount);
    console.log(`Keeping ${expCount} dates for ${ticker}:`, keepDates);
    
    const cacheDirs = [
      path.join(__dirname, '..', 'cache', 'uw', ticker),
      path.join(__dirname, '..', 'cache', 'dealer', ticker)
    ];
    
    for (const cacheDir of cacheDirs) {
      if (fs.existsSync(cacheDir)) {
        const dirs = fs.readdirSync(cacheDir, { withFileTypes: true });
        for (const dirent of dirs) {
          if (dirent.isDirectory()) {
            const dirName = dirent.name;
            if (!keepDates.includes(dirName)) {
              const dirToRemove = path.join(cacheDir, dirName);
              console.log(`Removing expired/unused directory: ${dirToRemove}`);
              fs.rmSync(dirToRemove, { recursive: true, force: true });
            }
          }
        }
      }
    }
  }
  
  console.log('\nCache cleanup routine complete.');
}

main().catch(console.error);
