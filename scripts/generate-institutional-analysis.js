require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Free-tier testing provider - swap to Claude later by replacing only
// callLLM() below. Everything else (payload shape, prompt, cache format)
// is provider-agnostic on purpose.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim();
// gemini-2.0-flash/-lite return quota limit:0 on this account's free tier;
// gemini-flash-lite-latest is the one that actually has free daily quota
// (confirmed live - the other candidates either 404'd as retired or 429'd
// with a hard 0 limit despite being listed as available models).
const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-flash-lite-latest';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const cacheDir = path.join(__dirname, '..', 'cache');
const outputPath = path.join(cacheDir, 'institutional-analysis.json');

const SYSTEM_PROMPT = `Sos un analista institucional de mercados. Tu trabajo es leer datos cuantitativos de
liquidez macro, régimen de gamma de dealers (microestructura de opciones),
posicionamiento y flujo de dinero, e interpretarlos en un análisis breve y
accionable - no sos un chatbot conversacional, sos un analista que escribe un
informe diario.

Reglas:
- Español, tono profesional pero directo, sin relleno.
- 5 a 10 líneas máximo. Nada de introducciones tipo "Basándome en los datos...".
- Estructura: qué cambió → por qué importa → qué están haciendo probablemente los
  institucionales → conclusión con el escenario más probable (no una predicción
  categórica, usá lenguaje probabilístico: "sugiere", "es consistente con",
  "aumenta la probabilidad de").
- Conectá el régimen de gamma (gamma_regime) con el resto: Short Gamma amplifica
  movimientos (los dealers compran en subas y venden en bajas), Long Gamma los
  amortigua (compran en bajas, venden en subas). Usá esa lente para interpretar
  si el flujo institucional de hoy es más o menos probable que se traduzca en
  movimiento de precio.
- Mencioná los montos reales de flujo ETF (etf_flows) en dólares cuando sean
  relevantes, no solo el score agregado.
- Basate ÚNICAMENTE en los datos que te paso. Si algo no está en los datos, no lo
  inventes ni lo asumas.
- Si las señales son contradictorias entre sí (ej: liquidez subiendo pero VIX
  subiendo también), decilo explícitamente - eso es información valiosa, no un
  error a esconder.
- No des recomendaciones de trading ("comprá", "vendé"). Interpretá el flujo, no
  aconsejes la acción.`;

function loadJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

// Same "closest row >= 7 calendar days back" logic as
// compute-institutional-flow-score.js / MacroLiquidityPanel.tsx.
function weekAgoEntry(history) {
  if (history.length === 0) return null;
  const latest = history[history.length - 1];
  const targetDate = new Date(latest.date).getTime() - 7 * 24 * 60 * 60 * 1000;
  let best = null;
  for (let i = history.length - 1; i >= 0; i--) {
    if (new Date(history[i].date).getTime() <= targetDate) {
      best = history[i];
      break;
    }
  }
  return best;
}

// Lightweight regime read, not the full client-side engine (src/lib/
// gamma-regime-engine.ts computes quadrant/stability/forward-pressure from
// options chain data and isn't portable to a plain Node script without a
// real TS build step). This covers what the LLM actually needs to interpret
// the options/gamma layer: is dealer positioning long or short gamma today,
// and is that intensifying or fading vs yesterday. SPY only for now - it's
// the market-wide proxy the original dashboard's own Gamma Regime Chart uses.
function buildGammaSnapshot() {
  const history = loadJson(path.join(cacheDir, 'regime-history-SPY.json'), []);
  if (history.length === 0) return null;
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const today = sorted[sorted.length - 1];
  const yesterday = sorted.length > 1 ? sorted[sorted.length - 2] : null;

  return {
    ticker: 'SPY',
    fecha: today.date,
    spot: today.spot,
    regimen: today.net_gex >= 0 ? 'LONG_GAMMA' : 'SHORT_GAMMA',
    net_gex: today.net_gex,
    net_gex_delta_1d: yesterday ? today.net_gex - yesterday.net_gex : null,
    ema3_net_gex: today.ema3_net_gex,
    king_node: today.king_node
  };
}

function buildPayload() {
  const flowScoreHistory = loadJson(path.join(cacheDir, 'institutional-flow-score.json'), []);
  const fedLiquidity = loadJson(path.join(cacheDir, 'fed-liquidity.json'), []);
  const cot = loadJson(path.join(cacheDir, 'cot-positioning.json'), []);
  const alerts = loadJson(path.join(cacheDir, 'fund-flow-alerts.json'), []);

  const latestScore = flowScoreHistory[flowScoreHistory.length - 1];
  if (!latestScore) return null;

  const latestLiquidity = fedLiquidity[fedLiquidity.length - 1];
  const weekAgoLiquidity = fedLiquidity.length > 0 ? weekAgoEntry(fedLiquidity) : null;

  const cotByInstrument = new Map();
  for (const entry of cot) {
    const existing = cotByInstrument.get(entry.instrument);
    if (!existing || entry.date > existing.date) cotByInstrument.set(entry.instrument, entry);
  }

  const recentAlerts = [...alerts].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);

  return {
    fecha: latestScore.date,
    liquidez: latestLiquidity ? {
      net_liquidity: latestLiquidity.net_liquidity,
      net_liquidity_delta_7d: weekAgoLiquidity ? latestLiquidity.net_liquidity - weekAgoLiquidity.net_liquidity : null,
      walcl: latestLiquidity.walcl,
      walcl_delta_7d: weekAgoLiquidity ? latestLiquidity.walcl - weekAgoLiquidity.walcl : null,
      tga: latestLiquidity.tga,
      tga_delta_7d: weekAgoLiquidity ? latestLiquidity.tga - weekAgoLiquidity.tga : null,
      rrp: latestLiquidity.rrp,
      rrp_delta_7d: weekAgoLiquidity ? latestLiquidity.rrp - weekAgoLiquidity.rrp : null
    } : null,
    institutional_flow_score: {
      score: latestScore.score,
      label: latestScore.label,
      components: latestScore.components
    },
    gamma_regime: buildGammaSnapshot(),
    etf_flows: {
      spy_net_flow: latestScore.inputs?.spy_net_flow ?? null,
      qqq_net_flow: latestScore.inputs?.qqq_net_flow ?? null,
      iwm_net_flow: latestScore.inputs?.iwm_net_flow ?? null,
      total_net_flow: latestScore.inputs?.etf_net_flow_total ?? null
    },
    cot_semanal: Array.from(cotByInstrument.values()).map(c => ({
      instrumento: c.instrument,
      asset_mgr_net_change: c.asset_mgr_net_change,
      lev_money_net_change: c.lev_money_net_change
    })),
    fund_flow_alerts: recentAlerts.map(a => ({
      ticker: a.ticker,
      type: a.type,
      streak_days: a.streak_days,
      net_flow_total: a.net_flow_total
    }))
  };
}

async function callLLM(payload) {
  const userContent = `Datos de hoy:\n${JSON.stringify(payload, null, 2)}\n\nGenerá el análisis institucional de hoy con estos datos.`;

  const res = await fetch(`${GEMINI_ENDPOINT}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: userContent }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 500 }
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API HTTP ${res.status}: ${errText}`);
  }

  const json = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error(`Gemini response missing text: ${JSON.stringify(json)}`);
  return text.trim();
}

async function run() {
  if (!GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY missing from .env - get a free key at https://aistudio.google.com/apikey');
    process.exit(1);
  }

  const payload = buildPayload();
  if (!payload) {
    console.error('No institutional-flow-score.json data yet - run score:daily first.');
    process.exit(1);
  }

  const narrative = await callLLM(payload);

  const entry = {
    date: payload.fecha,
    narrative,
    model: GEMINI_MODEL,
    generated_at: new Date().toISOString(),
    inputs: payload
  };

  const existing = loadJson(outputPath, []);
  const withoutToday = existing.filter(e => e.date !== entry.date);
  withoutToday.push(entry);
  withoutToday.sort((a, b) => a.date.localeCompare(b.date));
  fs.writeFileSync(outputPath, JSON.stringify(withoutToday, null, 2), 'utf8');

  console.log(`Institutional analysis for ${entry.date} (${GEMINI_MODEL}):\n${narrative}`);
}

run().catch(err => {
  console.error('Failed to generate institutional analysis:', err.message);
  process.exit(1);
});
