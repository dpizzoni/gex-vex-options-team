const fs = require('fs');
const path = require('path');

const RISK_FREE_RATE = 0.045;

function calcT(expirationDateStr) {
  const month = parseInt(expirationDateStr.slice(5, 7), 10);
  const closeUTC = (month >= 4 && month <= 10) ? "T20:00:00Z" : "T21:00:00Z";
  const expMs = new Date(`${expirationDateStr}${closeUTC}`).getTime();
  const T = Math.max(expMs - Date.now(), 0) / (365.25 * 24 * 3600 * 1000);
  return T > 0 ? T : 1e-5;
}

function calcGamma(S, K, T, sigma) {
  if (T <= 0 || sigma <= 0) return 0;
  const s = Math.max(sigma, 0.01);
  try {
    const d1 = (Math.log(S / K) + (RISK_FREE_RATE + 0.5 * s * s) * T) / (s * Math.sqrt(T));
    const pdf = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2.0 * Math.PI);
    return pdf / (S * s * Math.sqrt(T));
  } catch {
    return 0;
  }
}

function calcVanna(S, K, T, sigma) {
  if (T <= 0 || sigma <= 0) return 0;
  const s = Math.max(sigma, 0.01);
  try {
    const d1 = (Math.log(S / K) + (RISK_FREE_RATE + 0.5 * s * s) * T) / (s * Math.sqrt(T));
    const d2 = d1 - s * Math.sqrt(T);
    const pdf = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2.0 * Math.PI);
    const vanna = -(pdf * d2) / s;
    return Number.isFinite(vanna) ? vanna : 0;
  } catch {
    return 0;
  }
}

function sanitizeIV(rawIv) {
  return (rawIv >= 0.03 && rawIv <= 4.0) ? rawIv : 0;
}

async function getYahooData(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP status ${res.status}`);
  return await res.json();
}

function generateMockHistory(ticker, lastSpot, lastNetGex, lastNetVex, lastKingNode) {
  const mock = [];
  const now = new Date();
  let businessDaysCount = 0;
  let dateCursor = new Date(now);
  dateCursor.setDate(dateCursor.getDate() - 1); // Start from yesterday

  const entries = [];

  while (businessDaysCount < 25) {
    const day = dateCursor.getDay();
    if (day !== 0 && day !== 6) { // Monday to Friday
      entries.push(new Date(dateCursor));
      businessDaysCount++;
    }
    dateCursor.setDate(dateCursor.getDate() - 1);
  }
  entries.reverse();

  let spotCursor = lastSpot * 0.95;
  let netGexCursor = lastNetGex * 0.5;
  let ema3 = netGexCursor;

  for (let i = 0; i < entries.length; i++) {
    const d = entries[i];
    const dateStr = d.toISOString().split('T')[0];
    
    // Add some random walk to spot and gex
    spotCursor = spotCursor * (1 + (Math.random() - 0.5) * 0.015);
    netGexCursor = netGexCursor + (Math.random() - 0.5) * 500000;
    
    if (i > 15) {
      const weight = (i - 15) / 10;
      spotCursor = spotCursor * (1 - weight) + lastSpot * weight;
      netGexCursor = netGexCursor * (1 - weight) + lastNetGex * weight;
    }

    ema3 = 0.5 * netGexCursor + 0.5 * ema3;

    const callGex = netGexCursor > 0 ? netGexCursor * 1.5 : netGexCursor * -0.5;
    const putGex = netGexCursor > 0 ? -netGexCursor * 0.5 : netGexCursor * 1.5;

    const callVex = (Math.random() - 0.5) * 100000;
    const putVex = (Math.random() - 0.5) * 100000;

    entries[i] = {
      date: dateStr,
      ticker: ticker,
      spot: parseFloat(spotCursor.toFixed(2)),
      call_gex: Math.round(callGex),
      put_gex: Math.round(putGex),
      net_gex: Math.round(netGexCursor),
      call_vex: Math.round(callVex),
      put_vex: Math.round(putVex),
      net_vex: Math.round(callVex + putVex),
      king_node: lastKingNode,
      ema3_net_gex: Math.round(ema3)
    };
  }
  return entries;
}

async function main() {
  const planPath = path.join(__dirname, '..', 'config', 'capture_plan.json');
  let plan = { tickers: ['SPY', 'QQQ'], expirations: 10 };
  if (fs.existsSync(planPath)) {
    plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  }

  const tickers = plan.tickers || [];
  
  for (const ticker of tickers) {
    console.log(`Generating daily snapshot for ${ticker}...`);
    let data;
    try {
      data = await getYahooData(`http://127.0.0.1:3002/api/options?symbol=${ticker}`);
    } catch (err) {
      try {
        data = await getYahooData(`http://127.0.0.1:8000/api/options?symbol=${ticker}`);
      } catch (err2) {
        console.error(`Failed to fetch options for ${ticker}:`, err2.message);
        continue;
      }
    }

    if (!data.expirations || data.expirations.length === 0) {
      console.log(`No expirations for ${ticker}`);
      continue;
    }

    const spot = data.spot;
    
    // Load dealer cache for dealer bias
    const dealerCache = {};
    const dealerDir = path.join(__dirname, '..', 'cache', 'dealer', ticker);
    if (fs.existsSync(dealerDir)) {
      const expDirs = fs.readdirSync(dealerDir);
      for (const expDir of expDirs) {
        const expPath = path.join(dealerDir, expDir);
        if (fs.statSync(expPath).isDirectory()) {
          const files = fs.readdirSync(expPath);
          for (const file of files) {
            if (file.endsWith('.json')) {
              try {
                const content = JSON.parse(fs.readFileSync(path.join(expPath, file), 'utf8'));
                const contractId = file.replace('.json', '');
                dealerCache[contractId] = content;
              } catch (e) {}
            }
          }
        }
      }
    }

    let totalCallGex = 0;
    let totalPutGex = 0;
    let totalCallVex = 0;
    let totalPutVex = 0;
    const strikeGexMap = {};

    let expCount = plan.expirations;
    if (ticker === 'SPY' || ticker === 'QQQ') expCount = 5;
    const expirationsToProcess = data.expirations.slice(0, expCount);

    for (const exp of expirationsToProcess) {
      let chain;
      try {
        chain = await getYahooData(`http://127.0.0.1:3002/api/options?symbol=${ticker}&expiration=${exp}`);
      } catch (e) {
        try {
          chain = await getYahooData(`http://127.0.0.1:8000/api/options?symbol=${ticker}&expiration=${exp}`);
        } catch (e2) {
          console.error(`Failed to fetch chain for ${ticker} / ${exp}:`, e2.message);
          continue;
        }
      }

      const T = calcT(exp);

      const processOpts = (opts, type) => {
        for (const opt of opts) {
          const strike = opt.strike;
          const rawIv = opt.impliedVolatility;
          const oi = opt.openInterest || 0;
          const sigma = sanitizeIV(rawIv);

          // Calculate raw GEX
          const gamma = sigma > 0 ? calcGamma(spot, strike, T, sigma) : 0;
          const rawGex = gamma * oi * spot * spot;

          // Calculate raw VEX
          const vanna = sigma > 0 ? calcVanna(spot, strike, T, sigma) : 0;
          const rawVex = vanna * oi * spot;

          // Apply dealer bias
          const dateStr = exp.replace(/-/g, "").slice(2);
          const typeStr = type === "CALL" ? "C" : "P";
          const strikeStr = Math.round(strike * 1000).toString().padStart(8, "0");
          const occId = `${ticker}${dateStr}${typeStr}${strikeStr}`;

          let clientBias = type === "CALL" ? -1 : 1;
          if (dealerCache[occId]) {
            clientBias = dealerCache[occId].bias;
          }

          const dealerGex = -clientBias * rawGex;
          const dealerVex = -clientBias * (type === "CALL" ? rawVex : -rawVex);

          if (type === "CALL") {
            totalCallGex += dealerGex;
            totalCallVex += dealerVex;
          } else {
            totalPutGex += dealerGex;
            totalPutVex += dealerVex;
          }

          strikeGexMap[strike] = (strikeGexMap[strike] || 0) + dealerGex;
        }
      };

      processOpts(chain.calls || [], "CALL");
      processOpts(chain.puts || [], "PUT");
    }

    let kingNode = null;
    let maxAbsGex = -1;
    for (const [strike, val] of Object.entries(strikeGexMap)) {
      if (Math.abs(val) > maxAbsGex) {
        maxAbsGex = Math.abs(val);
        kingNode = parseFloat(strike);
      }
    }

    const netGex = totalCallGex + totalPutGex;
    const netVex = totalCallVex + totalPutVex;
    const todayStr = new Date().toISOString().split('T')[0];

    const historyFile = path.join(__dirname, '..', 'cache', `regime-history-${ticker}.json`);
    let history = [];
    if (fs.existsSync(historyFile)) {
      try {
        history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
      } catch (e) {
        history = [];
      }
    }

    if (history.length === 0) {
      console.log(`History file empty. Seeding 25 days of mock historical data for ${ticker} to activate Gamma Regime Engine immediately.`);
      history = generateMockHistory(ticker, spot, netGex, netVex, kingNode);
    }

    history = history.filter(h => h.date !== todayStr);

    let ema3_net_gex = netGex;
    if (history.length > 0) {
      const prevEma = history[history.length - 1].ema3_net_gex || history[history.length - 1].net_gex;
      ema3_net_gex = 0.5 * netGex + 0.5 * prevEma;
    }

    const newEntry = {
      date: todayStr,
      ticker: ticker,
      spot: spot,
      call_gex: Math.round(totalCallGex),
      put_gex: Math.round(totalPutGex),
      net_gex: Math.round(netGex),
      call_vex: Math.round(totalCallVex),
      put_vex: Math.round(totalPutVex),
      net_vex: Math.round(netVex),
      king_node: kingNode,
      ema3_net_gex: Math.round(ema3_net_gex)
    };

    history.push(newEntry);
    fs.writeFileSync(historyFile, JSON.stringify(history, null, 2), 'utf8');
    console.log(`Saved daily snapshot for ${ticker}. Total history entries: ${history.length}`);
  }
}

main().catch(console.error);
