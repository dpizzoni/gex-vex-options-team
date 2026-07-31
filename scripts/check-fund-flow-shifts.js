const fs = require('fs');
const path = require('path');

// Detects institutional distribution/accumulation that UW's own UI never
// labels as a signal - it just shows daily in/out flow bars and premium
// numbers, one day at a time. The insight this repo wants is the pattern
// across several days: sustained net outflow while price holds up (quiet
// distribution) or sustained net inflow while price is flat/down (quiet
// accumulation) - see the "3-5 días consecutivos" heuristic from the
// original fund-flow research this feature is based on.
//
// Deliberately separate from scripts/check-regime-shifts.js and
// cache/regime-alerts.json - this is its own self-contained detector inside
// the Fund Flow & Posicionamiento feature, not wired into NotificationBell.

const cacheDir = path.join(__dirname, '..', 'cache');

const SECTOR_TICKERS = ['SPY', 'XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLRE', 'XLU', 'XLV', 'XLY'];
const alertsPath = path.join(cacheDir, 'fund-flow-alerts.json');

// Needs several real net_flow-dated days before a "streak" means anything -
// with only 1-2 days of history (this feature is brand new) this will
// correctly stay silent rather than flag noise.
const STREAK_LENGTH = 3;
const PRICE_FLAT_THRESHOLD = 0.005; // 0.5% - "held up" / "flat" tolerance
const RETENTION_DAYS = 14; // longer than regime-alerts' 7d: flow data is sparser while history is still building up

function loadJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function saveJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

// net_flow lags behind `date` (see uw-fetch-fund-flow.js) and isn't captured
// every single day yet, so the streak is built from net_flow_date order -
// the actual days a flow figure exists for - not the capture-day history.
// uw-fetch-fund-flow.js also mirrors the latest flow value onto "today"'s
// row for display, so the same net_flow_date can legitimately appear twice
// in the raw array (its own backfilled row + today's mirror) - dedupe by
// net_flow_date, not by array position, so that doesn't double-count a day.
function flowDatedEntries(history) {
  const byFlowDate = new Map();
  for (const h of history) {
    if (h.net_flow == null || !h.net_flow_date) continue;
    byFlowDate.set(h.net_flow_date, h.net_flow);
  }
  return Array.from(byFlowDate, ([net_flow_date, net_flow]) => ({ net_flow_date, net_flow }))
    .sort((a, b) => a.net_flow_date.localeCompare(b.net_flow_date));
}

function checkTicker(ticker, existingAlerts) {
  const filePath = path.join(cacheDir, `fund-flow-${ticker}.json`);
  const history = loadJson(filePath, []);
  const flowEntries = flowDatedEntries(history);
  if (flowEntries.length < STREAK_LENGTH) return [];

  const window = flowEntries.slice(-STREAK_LENGTH);
  const allNegative = window.every(e => e.net_flow < 0);
  const allPositive = window.every(e => e.net_flow > 0);
  if (!allNegative && !allPositive) return [];

  // Price context: compare `last` at the start vs. the end of the exact same
  // net_flow_date window (not just the last STREAK_LENGTH price rows by
  // position) - fund-flow-refresh now runs multiple times a day (morning,
  // intraday, close, see .circleci/config.yml), so "today"'s row can hold an
  // intraday snapshot from a run hours before net_flow itself catches up
  // (net_flow_date still mirrors yesterday until tonight's close). A
  // position-based slice would silently swap in that partial-day price and
  // drift the price window out of sync with which days the flow streak
  // actually covers, giving a different price_change_pct depending on what
  // time of day this script happened to run.
  const priceHistory = history.filter(h => h.last != null).sort((a, b) => a.date.localeCompare(b.date));
  const priceAtOrBefore = (dateStr) => [...priceHistory].reverse().find(h => h.date <= dateStr)?.last;
  const startPrice = priceAtOrBefore(window[0].net_flow_date);
  const endPrice = priceAtOrBefore(window[window.length - 1].net_flow_date);
  if (startPrice == null || endPrice == null || startPrice === 0) return [];
  const priceChangePct = (endPrice - startPrice) / startPrice;

  const latest = window[window.length - 1];
  const id = `${ticker}_${latest.net_flow_date}_FUND_FLOW_SHIFT`;
  if (existingAlerts.some(a => a.id === id)) return [];

  let type = null;
  if (allNegative && priceChangePct >= -PRICE_FLAT_THRESHOLD) {
    type = 'QUIET_DISTRIBUTION'; // outflows while price holds up or rises
  } else if (allPositive && priceChangePct <= PRICE_FLAT_THRESHOLD) {
    type = 'QUIET_ACCUMULATION'; // inflows while price is flat or falling
  }
  if (!type) return [];

  return [{
    id,
    ticker,
    type,
    streak_days: STREAK_LENGTH,
    net_flow_dates: window.map(e => e.net_flow_date),
    net_flow_total: window.reduce((sum, e) => sum + e.net_flow, 0),
    price_change_pct: Math.round(priceChangePct * 10000) / 100,
    date: latest.net_flow_date,
    detected_at: new Date().toISOString()
  }];
}

function pruneOld(alerts) {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - RETENTION_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return alerts.filter(a => a.date >= cutoffStr);
}

function run() {
  const existing = loadJson(alertsPath, []);
  let newAlerts = [];
  for (const ticker of SECTOR_TICKERS) {
    newAlerts = newAlerts.concat(checkTicker(ticker, existing.concat(newAlerts)));
  }

  const retained = pruneOld([...existing, ...newAlerts]);
  const prunedCount = existing.length + newAlerts.length - retained.length;

  if (newAlerts.length > 0 || prunedCount > 0) {
    const updated = retained.sort((a, b) => (a.date + a.ticker).localeCompare(b.date + b.ticker));
    saveJson(alertsPath, updated);
    if (newAlerts.length > 0) {
      console.log(`Added ${newAlerts.length} new fund-flow shift alert(s): ${newAlerts.map(a => `${a.ticker} ${a.type} ${a.date}`).join(', ')}`);
    }
    if (prunedCount > 0) {
      console.log(`Pruned ${prunedCount} fund-flow alert(s) older than ${RETENTION_DAYS} days.`);
    }
  } else {
    console.log('No new fund-flow shifts detected.');
  }
}

run();
