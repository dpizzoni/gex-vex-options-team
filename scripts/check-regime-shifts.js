const fs = require('fs');
const path = require('path');

const cacheDir = path.join(__dirname, '..', 'cache');

// Derived from whatever regime-history files actually exist, instead of a
// hardcoded list, so this stays in sync automatically as gamma:data's ticker
// list grows/shrinks (a hardcoded list here previously went stale and silently
// missed shifts on every ticker added after the initial SPY/QQQ/TSLA/GOOGL set).
const TICKERS = fs.readdirSync(cacheDir)
  .filter(f => f.startsWith('regime-history-') && f.endsWith('.json'))
  .map(f => f.slice('regime-history-'.length, -'.json'.length));
const alertsPath = path.join(cacheDir, 'regime-alerts.json');

function loadAlerts() {
  if (!fs.existsSync(alertsPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(alertsPath, 'utf8'));
  } catch (e) {
    return [];
  }
}

function saveAlerts(alerts) {
  fs.writeFileSync(alertsPath, JSON.stringify(alerts, null, 2), 'utf8');
}

// EXPERIMENTAL: regime flip based on the raw single-day net_gex sign (matches
// what the chart bars actually show), instead of the smoothed EMA3 used by
// src/lib/gamma-regime-engine.ts. Trades false-positive risk (one noisy day
// can flip it) for alerting the same day the bar color changes, instead of
// waiting for EMA3 to catch up a day or two later.
// backfill=true scans every day in history instead of just the last one (one-off seeding).
function checkTicker(ticker, existingAlerts, backfill) {
  const historyPath = path.join(cacheDir, `regime-history-${ticker}.json`);
  if (!fs.existsSync(historyPath)) return [];

  const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
  if (history.length < 21) return [];

  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const n = sorted.length;
  const startIdx = backfill ? 20 : n - 1;
  const found = [];

  for (let i = startIdx; i < n; i++) {
    const today = sorted[i];
    const yesterday = sorted[i - 1];

    const regimeToday = today.net_gex >= 0 ? 'LONG_GAMMA' : 'SHORT_GAMMA';
    const regimeYesterday = yesterday.net_gex >= 0 ? 'LONG_GAMMA' : 'SHORT_GAMMA';
    if (regimeToday === regimeYesterday) continue;

    const window30d = sorted.slice(Math.max(0, i - 29), i + 1);
    const avgAbs30d = window30d.reduce((sum, h) => sum + Math.abs(h.net_gex), 0) / window30d.length;
    const threshold = 0.10 * avgAbs30d;
    if (Math.abs(today.net_gex) <= threshold) continue;

    const id = `${ticker}_${today.date}`;
    if (existingAlerts.some(a => a.id === id)) continue;

    found.push({
      id,
      ticker,
      date: today.date,
      type: regimeToday === 'LONG_GAMMA' ? 'LONG_GAMMA_ENTRY' : 'SHORT_GAMMA_ENTRY',
      net_gex: today.net_gex,
      ema3_net_gex: today.ema3_net_gex,
      spot: today.spot
    });
  }
  return found;
}

function run() {
  const backfill = process.argv.includes('--backfill');
  const existing = loadAlerts();
  let newAlerts = [];
  for (const ticker of TICKERS) {
    newAlerts = newAlerts.concat(checkTicker(ticker, existing, backfill));
  }

  if (newAlerts.length > 0) {
    const updated = [...existing, ...newAlerts].sort((a, b) => (a.date + a.ticker).localeCompare(b.date + b.ticker));
    saveAlerts(updated);
    console.log(`Added ${newAlerts.length} new regime-shift alert(s): ${newAlerts.map(a => `${a.ticker} ${a.type} ${a.date}`).join(', ')}`);
  } else {
    console.log('No new regime shifts detected.');
  }
}

run();
