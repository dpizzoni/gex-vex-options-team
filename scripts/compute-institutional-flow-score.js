require('dotenv').config();
const fs = require('fs');
const path = require('path');
const YF = require('yahoo-finance2').default;

const yahooFinance = new YF({ suppressNotices: ['yahooSurvey'] });

const cacheDir = path.join(__dirname, '..', 'cache');
const outputPath = path.join(cacheDir, 'institutional-flow-score.json');

function loadJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

// Same "closest row >= 7 calendar days back" logic as MacroLiquidityPanel's
// weekAgoEntry - keeps the score's week-over-week deltas consistent with
// what the Fed Liquidity Monitor panel already shows.
function weekAgoEntry(history, dateKey = 'date') {
  if (history.length === 0) return null;
  const latest = history[history.length - 1];
  const targetDate = new Date(latest[dateKey]).getTime() - 7 * 24 * 60 * 60 * 1000;
  let best = null;
  for (let i = history.length - 1; i >= 0; i--) {
    if (new Date(history[i][dateKey]).getTime() <= targetDate) {
      best = history[i];
      break;
    }
  }
  return best;
}

// --- Component scorers -----------------------------------------------
// Each returns an integer in a fixed range. Thresholds are a first-pass
// heuristic (not backtested) - the point of v1 is a directionally-correct,
// explainable score; thresholds can be tuned once we have enough daily
// history to see how the score behaves against actual price action.

function scoreLiquidity(current, weekAgo) {
  if (weekAgo == null) return 0;
  const deltaPct = ((current - weekAgo) / Math.abs(weekAgo)) * 100;
  if (deltaPct > 0.5) return 2;
  if (deltaPct > 0.1) return 1;
  if (deltaPct < -0.5) return -2;
  if (deltaPct < -0.1) return -1;
  return 0;
}

function scoreCreditSpread(current, weekAgo) {
  if (weekAgo == null) return 0;
  const delta = current - weekAgo; // narrowing (negative) = bullish
  if (delta < -0.15) return 2;
  if (delta < -0.03) return 1;
  if (delta > 0.15) return -2;
  if (delta > 0.03) return -1;
  return 0;
}

function scoreDollar(current, weekAgo) {
  if (weekAgo == null) return 0;
  const deltaPct = ((current - weekAgo) / weekAgo) * 100; // weaker dollar (negative) = bullish for equities
  if (deltaPct < -1) return 2;
  if (deltaPct < -0.3) return 1;
  if (deltaPct > 1) return -2;
  if (deltaPct > 0.3) return -1;
  return 0;
}

function scoreVix(current, weekAgo) {
  if (weekAgo == null) return 0;
  let score = 0;
  if (current < 15) score += 1;
  else if (current > 25) score -= 1;
  const delta = current - weekAgo;
  if (delta < -2) score += 1;
  else if (delta > 3) score -= 2;
  else if (delta > 1) score -= 1;
  return Math.max(-2, Math.min(2, score));
}

function scoreUS10Y(current, weekAgo) {
  if (weekAgo == null) return 0;
  const delta = current - weekAgo; // falling yields = bullish for growth/duration
  if (delta < -0.15) return 1;
  if (delta > 0.15) return -1;
  return 0;
}

// QQQE (equal-weight Nasdaq-100) outperforming QQQ (cap-weight) = broad
// participation beyond mega-caps = bullish for the "is this a real rally"
// question from the original research notes.
function scoreBreadth(qqqPctChange, qqqePctChange) {
  if (qqqPctChange == null || qqqePctChange == null) return 0;
  const spread = qqqePctChange - qqqPctChange;
  if (spread > 1) return 2;
  if (spread > 0.2) return 1;
  if (spread < -1) return -2;
  if (spread < -0.2) return -1;
  return 0;
}

function scoreEtfFlow(netFlowUsd) {
  if (netFlowUsd == null) return 0;
  const billions = netFlowUsd / 1e9;
  if (billions > 1) return 2;
  if (billions > 0.2) return 1;
  if (billions < -1) return -2;
  if (billions < -0.2) return -1;
  return 0;
}

function labelForScore(score) {
  if (score >= 6) return 'Strong Buying';
  if (score >= 2) return 'Buying';
  if (score <= -6) return 'Strong Distribution';
  if (score <= -2) return 'Distribution';
  return 'Neutral';
}

// --- Breadth data (QQQ vs QQQE, 5 trading days) ------------------------
async function fetchBreadthPctChanges() {
  const period2 = new Date();
  const period1 = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const [qqq, qqqe] = await Promise.all([
    yahooFinance.chart('QQQ', { period1, period2, interval: '1d' }),
    yahooFinance.chart('QQQE', { period1, period2, interval: '1d' })
  ]);
  const pctChange5d = (quotes) => {
    const closes = quotes.quotes.filter(q => q.close != null).map(q => q.close);
    if (closes.length < 2) return null;
    const back = closes.length >= 6 ? closes.length - 6 : 0;
    return ((closes[closes.length - 1] - closes[back]) / closes[back]) * 100;
  };
  return {
    qqqPctChange: pctChange5d(qqq),
    qqqePctChange: pctChange5d(qqqe)
  };
}

async function run() {
  const fedLiquidity = loadJson(path.join(cacheDir, 'fed-liquidity.json'), []);
  const marketRisk = loadJson(path.join(cacheDir, 'market-risk.json'), []);
  const spyFlow = loadJson(path.join(cacheDir, 'fund-flow-SPY.json'), []);

  if (fedLiquidity.length === 0 || marketRisk.length === 0) {
    console.error('Missing fed-liquidity.json or market-risk.json - run macro:daily first.');
    process.exit(1);
  }

  const latestLiquidity = fedLiquidity[fedLiquidity.length - 1];
  const weekAgoLiquidity = weekAgoEntry(fedLiquidity);
  const latestRisk = marketRisk[marketRisk.length - 1];
  const weekAgoRisk = weekAgoEntry(marketRisk);

  const spyFlowSorted = [...spyFlow].filter(r => r.net_flow != null).sort((a, b) => a.date.localeCompare(b.date));
  const latestSpyFlow = spyFlowSorted[spyFlowSorted.length - 1]?.net_flow ?? null;

  let breadth = { qqqPctChange: null, qqqePctChange: null };
  try {
    breadth = await fetchBreadthPctChanges();
  } catch (err) {
    console.error('Breadth fetch (QQQ/QQQE) failed, scoring breadth as neutral:', err.message);
  }

  const components = {
    liquidity: scoreLiquidity(latestLiquidity.net_liquidity, weekAgoLiquidity?.net_liquidity),
    credit_spread: scoreCreditSpread(latestRisk.hy_oas, weekAgoRisk?.hy_oas),
    dollar: scoreDollar(latestRisk.dxy, weekAgoRisk?.dxy),
    vix: scoreVix(latestRisk.vix, weekAgoRisk?.vix),
    us10y: scoreUS10Y(latestRisk.us10y, weekAgoRisk?.us10y),
    breadth: scoreBreadth(breadth.qqqPctChange, breadth.qqqePctChange),
    etf_flows: scoreEtfFlow(latestSpyFlow)
  };

  const score = Object.values(components).reduce((a, b) => a + b, 0);
  const date = latestLiquidity.date > latestRisk.date ? latestLiquidity.date : latestRisk.date;

  const entry = {
    date,
    score,
    label: labelForScore(score),
    components,
    inputs: {
      net_liquidity: latestLiquidity.net_liquidity,
      hy_oas: latestRisk.hy_oas,
      dxy: latestRisk.dxy,
      vix: latestRisk.vix,
      us10y: latestRisk.us10y,
      qqq_pct_5d: breadth.qqqPctChange,
      qqqe_pct_5d: breadth.qqqePctChange,
      spy_net_flow: latestSpyFlow
    }
  };

  const existing = loadJson(outputPath, []);
  const withoutToday = existing.filter(e => e.date !== date);
  withoutToday.push(entry);
  withoutToday.sort((a, b) => a.date.localeCompare(b.date));
  fs.writeFileSync(outputPath, JSON.stringify(withoutToday, null, 2), 'utf8');
  console.log(`Institutional Flow Score for ${date}: ${score} (${entry.label})`);
  console.log(JSON.stringify(components, null, 2));
}

run();
