const fs = require('fs');
const path = require('path');

// Evaluates the 8 alert rules from docs/PROPUESTA_ALERTAS_FUERZA_RELATIVA.md
// against today's cache/relative-strength.json snapshot (produced by
// fetch-relative-strength.js, which must run first - `npm run rs:daily`
// then `npm run rs:alerts:daily`, chained in that order in the
// relative-strength-refresh job of .circleci/config.yml). Two outputs:
//   - cache/relative-strength-alerts-history.json: append-only { date,
//     ticker, score, insufficientHistory } log, trimmed to
//     historyRetentionDays - the only state this script needs across runs,
//     since delta1W/delta1M/returns for "today" already live in the daily
//     snapshot itself and don't need re-deriving here.
//   - cache/relative-strength-alerts.json: TODAY's fired alerts only,
//     bucketed and pre-sorted, with fully-formed Spanish `text` - the
//     component just renders this, no recomputation client-side (deliberate
//     choice from the proposal doc, unlike e.g. FundFlowPanel's COT alerts).

const cacheDir = path.join(__dirname, '..', 'cache');
const configPath = path.join(__dirname, '..', 'config', 'relative-strength-alerts.json');
const snapshotPath = path.join(cacheDir, 'relative-strength.json');
const historyPath = path.join(cacheDir, 'relative-strength-alerts-history.json');
const outputPath = path.join(cacheDir, 'relative-strength-alerts.json');

const DEFAULT_CONFIG = {
  leaderThresholdScore: 0.8,
  laggardThresholdScore: 0.2,
  regimeMidpointScore: 0.5,
  regimeHysteresisCloses: 2,
  // Score is a PERCENTRANK.INC output over a 25-session window, so its
  // own day-to-day change (delta1W/delta1M) is naturally noisy - a 69-
  // ticker universe reshuffles a lot just from normal rank churn. A fixed
  // pp cutoff (the original proposal's ±15pp) turned out to fire for
  // ~75% of the universe daily on real data - not a useful "unusual
  // move" signal. Top-N-by-percentile self-calibrates to whatever the
  // day's actual noise level is instead of a magic constant.
  rotationTopPercentile: 0.15,
  combinedLevelThresholdScore: 0.7,
  divergenceTopPercentile: 0.35,
  divergenceFlatBandPct: 0.01,
  confirmedLeaderScoreThreshold: 0.8,
  confirmedLeaderDistHighBand: 0.03,
  sustainedLeadershipScoreThreshold: 0.7,
  sustainedLeadershipDays: 5,
  historyRetentionDays: 45
};

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

function loadConfig() {
  const fromFile = loadJson(configPath, {});
  return { ...DEFAULT_CONFIG, ...fromFile };
}

function pct(score) {
  return Math.round(score * 1000) / 10; // 0.734 -> 73.4
}

// Cutoff value such that only the top `topPercentile` fraction of a sorted-
// ascending array exceeds it (e.g. topPercentile=0.15 -> the 85th
// percentile value; anything >= it is "top 15% of today's universe").
// Recomputed fresh every run from that day's actual values - see the
// rotationTopPercentile comment above for why this replaced a fixed pp cutoff.
function topPercentileCutoff(sortedAsc, topPercentile) {
  if (sortedAsc.length === 0) return Infinity;
  const idx = Math.min(sortedAsc.length - 1, Math.floor((1 - topPercentile) * sortedAsc.length));
  return sortedAsc[idx];
}

// Computes today's dynamic cutoffs from the eligible universe (excludes
// benchmark/insufficientHistory, same population the alerts themselves
// only fire for).
function computeDynamicCutoffs(cfg, snapshot) {
  const eligible = snapshot.universe.filter(u => !u.isBenchmark && !u.insufficientHistory);
  const abs1w = eligible.map(u => u.delta1W).filter(v => v != null).map(Math.abs).sort((a, b) => a - b);
  const abs1m = eligible.map(u => u.delta1M).filter(v => v != null).map(Math.abs).sort((a, b) => a - b);
  return {
    delta1WCutoff: topPercentileCutoff(abs1w, cfg.rotationTopPercentile),
    delta1MCutoff: topPercentileCutoff(abs1m, cfg.rotationTopPercentile),
    divergenceDelta1WCutoff: topPercentileCutoff(abs1w, cfg.divergenceTopPercentile)
  };
}

// Appends today's rows (idempotent - re-running the same day just no-ops),
// trims to the retention window, and returns { history, byTicker } where
// byTicker maps ticker -> ascending-by-date rows (including today).
function updateHistory(cfg, snapshot) {
  const history = loadJson(historyPath, []);
  const existingKeys = new Set(history.map(r => `${r.date}_${r.ticker}`));

  for (const u of snapshot.universe) {
    if (u.isBenchmark) continue;
    const key = `${snapshot.asOf}_${u.ticker}`;
    if (existingKeys.has(key)) continue;
    history.push({
      date: snapshot.asOf,
      ticker: u.ticker,
      score: u.score,
      insufficientHistory: u.insufficientHistory
    });
  }

  const cutoff = new Date(snapshot.asOf + 'T00:00:00Z');
  cutoff.setUTCDate(cutoff.getUTCDate() - cfg.historyRetentionDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const trimmed = history.filter(r => r.date >= cutoffStr).sort((a, b) => (a.date + a.ticker).localeCompare(b.date + b.ticker));

  saveJson(historyPath, trimmed);

  const byTicker = new Map();
  for (const row of trimmed) {
    const arr = byTicker.get(row.ticker) ?? [];
    arr.push(row);
    byTicker.set(row.ticker, arr);
  }
  for (const arr of byTicker.values()) arr.sort((a, b) => a.date.localeCompare(b.date));
  return byTicker;
}

// Rules 1+2: level crossings. Regime crossing (#2) requires the new side to
// hold for regimeHysteresisCloses consecutive closes (incl. today) to avoid
// flip-flopping on noise right at the 50% midpoint - see "Histéresis" in the
// proposal doc. Leader/laggard crossing (#1) fires on the raw single-day
// cross; 80/20 is far enough from the noise band that hysteresis wasn't
// asked for there.
function checkCrossings(cfg, rows, entry) {
  const alerts = [];
  const n = rows.length;
  if (n < 2) return alerts;
  const today = rows[n - 1];
  const yesterday = rows[n - 2];
  if (today.score == null || yesterday.score == null) return alerts;

  // sortMagnitude uses a +1 offset for "up" (leader) alerts so a single
  // descending sort groups all leaders before all laggards - within each
  // group it still orders by what that alert actually measures: leaders by
  // score descending (strongest first), laggards by score ascending
  // (weakest/most-lagging first, since 1-score is largest when score is
  // smallest).
  if (yesterday.score < cfg.leaderThresholdScore && today.score >= cfg.leaderThresholdScore) {
    alerts.push({
      rule: 'LEADER_CROSS_UP',
      bucket: 'liderazgo',
      ticker: entry.ticker,
      name: entry.name,
      text: `${entry.ticker} cruzó a nuevo líder (score ${pct(today.score)}%)`,
      sortMagnitude: 1 + today.score
    });
  }
  if (yesterday.score > cfg.laggardThresholdScore && today.score <= cfg.laggardThresholdScore) {
    alerts.push({
      rule: 'LEADER_CROSS_DOWN',
      bucket: 'liderazgo',
      ticker: entry.ticker,
      name: entry.name,
      text: `${entry.ticker} cayó a nuevo rezagado (score ${pct(today.score)}%)`,
      sortMagnitude: 1 - today.score
    });
  }

  const need = cfg.regimeHysteresisCloses;
  if (n >= need + 1) {
    const preWindow = rows.slice(n - need - 1, n); // [before-window..., ...window]
    const windowRows = preWindow.slice(1); // the `need` closes being confirmed
    const before = preWindow[0];
    if (before.score != null && windowRows.every(r => r.score != null)) {
      const wasBelow = before.score < cfg.regimeMidpointScore;
      const wasAbove = before.score >= cfg.regimeMidpointScore;
      const allAbove = windowRows.every(r => r.score >= cfg.regimeMidpointScore);
      const allBelow = windowRows.every(r => r.score < cfg.regimeMidpointScore);
      if (wasBelow && allAbove) {
        alerts.push({
          rule: 'REGIME_CROSS_UP',
          bucket: 'liderazgo',
          ticker: entry.ticker,
          name: entry.name,
          text: `${entry.ticker} pasó a más fuerte que el benchmark, sostenido ${need} cierres (score ${pct(today.score)}%)`,
          sortMagnitude: 1 + today.score
        });
      } else if (wasAbove && allBelow) {
        alerts.push({
          rule: 'REGIME_CROSS_DOWN',
          bucket: 'liderazgo',
          ticker: entry.ticker,
          name: entry.name,
          text: `${entry.ticker} pasó a más débil que el benchmark, sostenido ${need} cierres (score ${pct(today.score)}%)`,
          sortMagnitude: 1 - today.score
        });
      }
    }
  }

  return alerts;
}

// Rules 3+4: momentum/rotation, independent of level, plus the combined
// "level already high + accelerating" reading the original sheet
// recommends. Uses today's dynamic top-N cutoffs (see computeDynamicCutoffs)
// instead of a fixed pp threshold.
//
// sortMagnitude uses 3 tiers, same offset idea as checkCrossings: within
// each tier the more extreme move sorts first, and tiers never mix under a
// single descending sort since each offset comfortably exceeds any
// realistic |Δ1W|+|Δ1M| (pp deltas, bounded ~200).
//   1. LEVEL_PLUS_ACCEL - a confirmed leader (score already high) still
//      accelerating is a stronger, more actionable signal than raw
//      rotation speed alone (it tells you WHERE the mover already sits,
//      not just how fast it's moving) - the reading the original sheet
//      specifically recommends, so it leads.
//   2. ROTATION_ACCEL, up direction (Δ1W > 0).
//   3. ROTATION_ACCEL, down direction (Δ1W < 0) - no offset.
const ROTATION_TIER_LEVEL_PLUS_ACCEL = 2000;
const ROTATION_TIER_UP = 1000;

function checkMomentum(cfg, cutoffs, entry) {
  const alerts = [];
  const d1w = entry.delta1W;
  const d1m = entry.delta1M;

  // Requires BOTH Δ1W and Δ1M in their respective top rotationTopPercentile
  // cutoffs (AND, not OR) - tightened after seeing ~26% of the universe
  // qualify under an "either window" reading at top-15%. A ticker rotating
  // hard in only one window is still visible via LEVEL_PLUS_ACCEL (Δ1W-only)
  // when it's also already a leader.
  if (d1w != null && d1m != null &&
      Math.abs(d1w) >= cutoffs.delta1WCutoff && Math.abs(d1m) >= cutoffs.delta1MCutoff) {
    const magnitude = Math.abs(d1w) + Math.abs(d1m);
    alerts.push({
      rule: 'ROTATION_ACCEL',
      bucket: 'rotacion',
      ticker: entry.ticker,
      name: entry.name,
      text: `${entry.ticker} rotación acelerada: Δ1W ${d1w >= 0 ? '+' : ''}${d1w.toFixed(1)}pp, Δ1M ${d1m >= 0 ? '+' : ''}${d1m.toFixed(1)}pp`,
      sortMagnitude: d1w > 0 ? ROTATION_TIER_UP + magnitude : magnitude
    });
  }

  if (entry.score != null && entry.score >= cfg.combinedLevelThresholdScore &&
      d1w != null && d1w >= cutoffs.delta1WCutoff) {
    // Always the "up" direction by construction (d1w >= a positive cutoff).
    alerts.push({
      rule: 'LEVEL_PLUS_ACCEL',
      bucket: 'rotacion',
      ticker: entry.ticker,
      name: entry.name,
      text: `${entry.ticker} líder ganando tracción: score ${pct(entry.score)}% y Δ1W +${d1w.toFixed(1)}pp`,
      sortMagnitude: ROTATION_TIER_LEVEL_PLUS_ACCEL + Math.abs(d1w)
    });
  }

  return alerts;
}

// Rules 5+6: confirmation against price. Divergence (#5) is scored against
// returns.week (same horizon as delta1W - decided over returns.month for
// being more reactive and consistent with the rest of the weekly signals).
// scoreRising/scoreFalling use the same dynamic top-N cutoff idea as
// checkMomentum (a fixed minimum pp had the identical over-firing problem),
// just at a looser percentile (divergenceTopPercentile) since this rule
// only needs "non-trivial move", not "extreme move".
//
// sortMagnitude: same up-before-down grouping as checkCrossings/
// checkMomentum. CONFIRMED_LEADER and DIVERGENCE_UP are always bullish (+1
// offset); DIVERGENCE_DOWN stays unoffset (its 1-score already sorts
// weakest-score-first when read descending, same "ascending by score"
// behavior as the laggards group in checkCrossings).
function checkConfirmation(cfg, cutoffs, entry) {
  const alerts = [];
  const d1w = entry.delta1W;
  const weekReturn = entry.returns?.week;

  if (d1w != null && weekReturn != null) {
    const scoreRising = d1w >= cutoffs.divergenceDelta1WCutoff;
    const scoreFalling = d1w <= -cutoffs.divergenceDelta1WCutoff;
    const priceFlatOrDown = weekReturn <= cfg.divergenceFlatBandPct;
    const priceFlatOrUp = weekReturn >= -cfg.divergenceFlatBandPct;

    if (scoreRising && priceFlatOrDown) {
      alerts.push({
        rule: 'DIVERGENCE_UP',
        bucket: 'confirmacion',
        ticker: entry.ticker,
        name: entry.name,
        text: `${entry.ticker} divergencia: score sube (Δ1W +${d1w.toFixed(1)}pp) con precio plano/negativo esta semana (${(weekReturn * 100).toFixed(1)}%)`,
        sortMagnitude: 1 + (entry.score ?? 0)
      });
    } else if (scoreFalling && priceFlatOrUp) {
      alerts.push({
        rule: 'DIVERGENCE_DOWN',
        bucket: 'confirmacion',
        ticker: entry.ticker,
        name: entry.name,
        text: `${entry.ticker} divergencia: score cae (Δ1W ${d1w.toFixed(1)}pp) con precio plano/positivo esta semana (${(weekReturn * 100).toFixed(1)}%)`,
        sortMagnitude: 1 - (entry.score ?? 1)
      });
    }
  }

  const distHigh = entry.returns?.dist52wHigh;
  if (entry.score != null && entry.score >= cfg.confirmedLeaderScoreThreshold &&
      distHigh != null && distHigh >= -cfg.confirmedLeaderDistHighBand) {
    alerts.push({
      rule: 'CONFIRMED_LEADER',
      bucket: 'confirmacion',
      ticker: entry.ticker,
      name: entry.name,
      text: `${entry.ticker} líder confirmado: score ${pct(entry.score)}% y a ${(distHigh * 100).toFixed(1)}% de su máximo de 52 semanas`,
      sortMagnitude: 1 + entry.score
    });
  }

  return alerts;
}

// Rules 7+8: persistence/signal quality. Sustained leadership (#7) fires
// once, the day the streak first reaches sustainedLeadershipDays (not every
// day after) - checked by requiring the day just before the window to
// either not exist or sit below threshold.
function checkPersistence(cfg, rows, entry) {
  const alerts = [];
  const n = rows.length;
  const need = cfg.sustainedLeadershipDays;

  if (n >= need) {
    const window = rows.slice(n - need);
    const allQualify = window.every(r => r.score != null && r.score >= cfg.sustainedLeadershipScoreThreshold);
    if (allQualify) {
      const before = n > need ? rows[n - need - 1] : null;
      const justReachedStreak = !before || before.score == null || before.score < cfg.sustainedLeadershipScoreThreshold;
      if (justReachedStreak) {
        alerts.push({
          rule: 'SUSTAINED_LEADERSHIP',
          bucket: 'persistencia',
          ticker: entry.ticker,
          name: entry.name,
          text: `${entry.ticker} liderazgo sostenido ${need} sesiones seguidas (score actual ${pct(entry.score)}%)`,
          sortMagnitude: need
        });
      }
    }
  }

  if (n >= 2) {
    const today = rows[n - 1];
    const yesterday = rows[n - 2];
    if (yesterday.insufficientHistory === true && today.insufficientHistory === false) {
      alerts.push({
        rule: 'NEWLY_ELIGIBLE',
        bucket: 'persistencia',
        ticker: entry.ticker,
        name: entry.name,
        text: `${entry.ticker} alcanzó historial suficiente - ya tiene score real (${pct(entry.score)}%)`,
        sortMagnitude: 1
      });
    }
  }

  return alerts;
}

function run() {
  const cfg = loadConfig();
  const snapshot = loadJson(snapshotPath, null);
  if (!snapshot || !snapshot.asOf || !Array.isArray(snapshot.universe)) {
    throw new Error('cache/relative-strength.json missing or malformed - run fetch-relative-strength.js first');
  }

  const byTicker = updateHistory(cfg, snapshot);
  const cutoffs = computeDynamicCutoffs(cfg, snapshot);

  const allAlerts = [];
  for (const entry of snapshot.universe) {
    if (entry.isBenchmark || entry.insufficientHistory) continue;
    const rows = byTicker.get(entry.ticker) ?? [];

    allAlerts.push(
      ...checkCrossings(cfg, rows, entry),
      ...checkMomentum(cfg, cutoffs, entry),
      ...checkConfirmation(cfg, cutoffs, entry),
      ...checkPersistence(cfg, rows, entry)
    );
  }
  const withId = allAlerts.map(({ idKey, ...a }) => ({
    id: `${snapshot.asOf}_${a.ticker}_${idKey ?? a.rule}`,
    date: snapshot.asOf,
    ...a
  }));

  const buckets = { liderazgo: [], rotacion: [], confirmacion: [], persistencia: [] };
  for (const a of withId) buckets[a.bucket].push(a);
  for (const key of Object.keys(buckets)) {
    buckets[key].sort((a, b) => b.sortMagnitude - a.sortMagnitude);
  }

  const output = {
    date: snapshot.asOf,
    generatedAt: new Date().toISOString(),
    dynamicCutoffs: cutoffs,
    buckets
  };
  saveJson(outputPath, output);

  const total = Object.values(buckets).reduce((sum, arr) => sum + arr.length, 0);
  console.log(`Relative Strength alerts for ${snapshot.asOf}: ${total} fired across ${Object.keys(buckets).filter(k => buckets[k].length > 0).length} bucket(s).`);
}

module.exports = { run };

if (require.main === module) {
  run();
}
