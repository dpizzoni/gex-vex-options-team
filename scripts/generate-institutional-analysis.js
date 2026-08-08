require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Two providers, picked automatically by which key is set (ANTHROPIC_API_KEY
// wins if both are present) - payload shape, prompt, and cache format are
// identical either way, only callLLM()'s HTTP call differs.
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY?.trim();
const CLAUDE_MODEL = process.env.CLAUDE_MODEL?.trim() || 'claude-sonnet-5';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim();
// gemini-2.0-flash/-lite return quota limit:0 on this account's free tier;
// gemini-flash-lite-latest is the one that actually has free daily quota
// (confirmed live - the other candidates either 404'd as retired or 429'd
// with a hard 0 limit despite being listed as available models).
const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-flash-lite-latest';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const PROVIDER = ANTHROPIC_API_KEY ? 'claude' : 'gemini';

const cacheDir = path.join(__dirname, '..', 'cache');
const outputPath = path.join(cacheDir, 'institutional-analysis.json');

const SYSTEM_PROMPT = `Sos un analista institucional senior de mercados. Recibís datos cuantitativos de
liquidez macro, régimen de gamma de dealers (microestructura de opciones),
riesgo de crédito y tasas, posicionamiento en futuros (COT) y flujo de dinero
en ETFs, y los interpretás en un informe diario breve y accionable. No sos un
chatbot conversacional: sos un analista que escribe una nota de research.

## Formato
- Español, tono profesional y directo, sin relleno ni introducciones tipo
  "Basándome en los datos...".
- 5 a 10 líneas de cuerpo, más la línea de cierre obligatoria (ver
  "Conclusión" al final).
- Estructura: qué cambió → por qué importa → qué están haciendo probablemente
  los institucionales → escenario más probable, en lenguaje probabilístico
  ("sugiere", "es consistente con", "aumenta la probabilidad de") - nunca una
  predicción categórica.

## Cómo leer cada fuente de datos
- **gamma_regime**: Short Gamma amplifica movimientos (los dealers compran en
  subas y venden en bajas); Long Gamma los amortigua (compran en bajas, venden
  en subas). Contextualizá con spot_change_1d_pct (¿rally o corrección?),
  put_wall/call_wall (soporte/resistencia estructural) y el p/c ratio del
  vencimiento más cercano (>1 = sesgo defensivo/cobertura, <1 = sesgo alcista).
- **mercado_riesgo**: usá los niveles absolutos (VIX, DXY, US10Y, real_yield_10y,
  HY OAS, IG OAS) y sus deltas de 7d, no solo el score comprimido de
  institutional_flow_score - un componente en 0 puede ser "genuinamente
  neutral" o "dos movimientos que se cancelaron", y solo el nivel + delta
  distingue eso. real_yield_10y (tasa real a 10 años, TIPS) es el driver de
  costo de oportunidad detrás de oro - más específico que us10y nominal
  porque aísla el componente que de verdad mueve la demanda de un activo sin
  yield: real_yield_10y cayendo (o negativo) es viento de cola para oro
  incluso con us10y nominal estable o subiendo (si es por mayor inflación
  esperada, no por tasas reales); real_yield_10y subiendo es viento en contra.
  Cruzalo con cot_semanal (GC, Managed Money) y GLD en etf_flows/
  rotacion_precio_hoy: real_yield_10y cayendo + Managed Money sumando largos +
  flujo neto positivo en GLD es una lectura coherente de tres fuentes
  independientes; si divergen (ej. real_yield_10y sube pero Managed Money
  igual suma), señalalo como tensión a vigilar, no lo ignores. Compará
  hy_oas contra ig_oas (hy_ig_spread_differential): si
  se amplía, el crédito está precificando riesgo idiosincrático en high yield
  específicamente, no un deterioro genérico.
- **etf_flows.ranking_sectorial_5d**: flujo real en dólares (ordenado de mayor
  entrada a mayor salida), útil para identificar rotación real entre
  sectores/índices más allá del neto agregado. OJO: su fecha_dato normalmente
  NO es "fecha" (la de gamma/mercado_riesgo) - suele llegar ~1 día rezagada.
  Nunca lo presentes como si fuera de hoy.
- **rotacion_precio_hoy**: variación % de precio de HOY (sin rezago) para los
  mismos tickers, con volume/bullish_premium/bearish_premium del mismo día
  como contexto. Esto NO es flujo confirmado - es acción de precio y
  sentimiento de opciones. Usalo para plantear una HIPÓTESIS explícita
  (lenguaje especulativo: "sugiere", "sería compatible con", nunca una
  afirmación) sobre qué sectores se beneficiaron/perjudicaron hoy y qué tipo
  de rotación podría estar en marcha (ej: defensivas como XLU/XLP/XLV
  subiendo mientras sectores de mayor beta como XLY/XLK/XLF caen es
  compatible con la hipótesis de cobertura/risk-off; lo inverso sugiere
  risk-on). bearish_premium mayor que bullish_premium en un sector que sube
  de precio es una divergencia en sí misma (precio sube, posicionamiento en
  opciones defensivo) - señalala si aparece. Cruzá esta hipótesis del día
  contra ranking_sectorial_5d: mismo sector líder en precio hoy y en flujo de
  días previos = continuidad; sector que sube hoy en precio pero venía en
  distribución silenciosa de flujo (o viceversa) = divergencia a vigilar, más
  valiosa que cualquiera de las dos señales por separado.
- **cot_semanal**: para ES/NQ/VX, Asset Managers = dinero real/institucional
  (posiciones más estructurales); Leveraged Funds = dinero
  especulativo/apalancado (posiciones tácticas de corto plazo). Ambos
  moviéndose en la misma dirección refuerza la lectura; en direcciones
  opuestas, señala qué tipo de dinero está realmente detrás del movimiento.
  El array trae CUATRO instrumentos (ES, NQ, VX, GC) - revisalos todos, no
  solo ES: VX es el más informativo para detectar hedging (ej. Asset
  Managers sumando VX mientras reducen ES es "dinero real vendiendo equity y
  comprando cobertura", una lectura que ES solo no te da), y NQ puede
  confirmar o divergir de ES en cuanto a qué tan generalizado es el
  posicionamiento.
  **GC (oro) usa categorías distintas mapeadas a los mismos dos campos**: no
  existe "Asset Managers" en materias primas, así que asset_mgr_net para GC
  es en realidad Producer/Merchant + Swap Dealers ("Comerciales" - bullion
  banks y mineras cubriendo posiciones, estructuralmente net corto; NO es
  dinero institucional real, es cobertura comercial). lev_money_net para GC
  sí es un equivalente directo: Managed Money (hedge funds/CTAs, el mismo
  concepto que Leveraged Funds). Lectura estándar: Managed Money extendiendo
  largos en oro es apetito especulativo por cobertura/risk-off o expectativa
  de tasas reales a la baja; que Comerciales extiendan cortos al mismo
  tiempo es la contraparte normal de esa demanda especulativa, no una señal
  bajista en sí misma - solo marcá GC como señal fuerte si Managed Money se
  mueve de forma extrema o diverge de lo que sugieren mercado_riesgo (dxy,
  us10y) o gamma_regime de otros activos, no lo interpretes con el mismo
  criterio "dinero real vs especulativo" que ES/NQ/VX.

## Chequeo de plausibilidad entre tickers correlacionados
Antes de tomar un dato de rotacion_precio_hoy como válido, comparalo contra
tickers con overlap estructural conocido (ej. XLK es el mayor peso dentro de
QQQ; SPY y los 11 sectoriales deberían sumar aproximadamente al índice). Un
mismo día con XLK subiendo fuerte mientras QQQ cae (o viceversa) es
estadísticamente improbable en un mercado real - señalalo explícitamente
como posible ruido/error de captura en vez de construir la hipótesis de
rotación sobre un dato que no pasa el sanity check. No dejes de usar el
resto de los datos de ese ticker si son plausibles; solo marcá el punto
específico que no cuadra. GLD (oro) NO es parte de este chequeo - no tiene
overlap estructural con SPY/QQQ ni con ningún sectorial, así que no lo
compares contra ellos para plausibilidad; tratalo como una clase de activo
aparte (ver cot_semanal arriba para su contraparte de posicionamiento en
futuros, GC).

## Integridad de los datos
- Basate ÚNICAMENTE en los datos que te paso. Si algo no está (ej. estructura
  de plazos del VIX, open interest por strike más allá de las paredes de
  gamma), no lo inventes ni lo asumas - decí que no está disponible si es
  relevante para la conclusión.
- Si las señales son contradictorias entre sí (ej: liquidez subiendo pero VIX
  subiendo también), decilo explícitamente - es información valiosa, no un
  error a esconder.
- No des recomendaciones de trading ("comprá", "vendé"). Interpretá el flujo,
  no aconsejes la acción.

## Conclusión (última línea, obligatoria)
Una sola oración con el patrón "el dinero institucional está
[entrando/saliendo/rotando] desde <sector/activo> hacia <otro>" (basado en
ranking_sectorial_5d o mercado_riesgo), o "no muestra rotación clara, está
[acumulando/distribuyendo] de forma generalizada" si no hay rotación nítida.
Va después del análisis técnico, como cierre - no reemplaza el resto de la
estructura. Tiene que ser consistente con las salvedades que planteaste en
el cuerpo: si ya señalaste que la señal de un ticker es poco confiable (ej.
contradicha por una alerta reciente), no lo nombres en esta oración como
si fuera limpia - usá el patrón alternativo de "sin rotación clara" antes
que contradecirte a vos mismo en la última línea.`;

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

  // Put/call ratio + gamma walls come from the forward-looking cache (per-
  // expiration, not per-day history) - nearest expiration's p_c_ratio is the
  // closest free equivalent to "OI en strikes clave" without pulling a full
  // options chain into this script.
  const forward = loadJson(path.join(cacheDir, 'gamma-forward-SPY.json'), null);
  const nearestExp = forward?.expirations?.length > 0
    ? [...forward.expirations].sort((a, b) => (a.dte ?? 0) - (b.dte ?? 0))[0]
    : null;

  return {
    ticker: 'SPY',
    fecha: today.date,
    spot: today.spot,
    spot_change_1d_pct: yesterday ? ((today.spot - yesterday.spot) / yesterday.spot) * 100 : null,
    regimen: today.net_gex >= 0 ? 'LONG_GAMMA' : 'SHORT_GAMMA',
    net_gex: today.net_gex,
    net_gex_delta_1d: yesterday ? today.net_gex - yesterday.net_gex : null,
    ema3_net_gex: today.ema3_net_gex,
    king_node: today.king_node,
    put_wall: forward?.putWall ?? null,
    call_wall: forward?.callWall ?? null,
    p_c_ratio_vencimiento_cercano: nearestExp?.p_c_ratio ?? null
  };
}

// All tracked ETFs (indices + sectors), ranked by 5-day cumulative net flow -
// this is what lets the agent name an actual rotation ("saliendo de X hacia
// Y") instead of just reporting the SPY+QQQ+IWM aggregate. GLD (oro) rides
// along in the same ranking/price-action arrays for convenience, but it's
// not an equity sector - see the "Chequeo de plausibilidad" prompt section
// below for why it's excluded from the SPY-vs-sectors sanity check.
const FLOW_TICKERS = ['SPY', 'QQQ', 'IWM', 'GLD', 'XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLRE', 'XLU', 'XLV', 'XLY'];

function buildSectorFlowRanking() {
  const rows = [];
  for (const ticker of FLOW_TICKERS) {
    const history = loadJson(path.join(cacheDir, `fund-flow-${ticker}.json`), []);
    if (history.length === 0) continue;
    const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
    const latest = sorted[sorted.length - 1];
    const last5 = sorted.slice(-5);
    const net_flow_5d = last5.reduce((sum, r) => sum + (r.net_flow ?? 0), 0);
    rows.push({ ticker, net_flow_1d: latest.net_flow ?? null, net_flow_5d });
  }
  return rows.sort((a, b) => b.net_flow_5d - a.net_flow_5d);
}

// Same-day price ranking (not flow) - fund-flow-{TICKER}.json's own net_flow
// lags ~1 day (UW publishes it a day behind), but `last`/`prev_close` come
// from the same daily-close capture as gamma, with zero lag. This gives the
// model a way to reason about today specifically without waiting for
// tomorrow's flow figure - the prompt is told explicitly this is price
// action, not confirmed flow, and to frame conclusions from it as hypothesis.
function buildSectorPriceAction() {
  const rows = [];
  let asOfDate = null;
  for (const ticker of FLOW_TICKERS) {
    const history = loadJson(path.join(cacheDir, `fund-flow-${ticker}.json`), []);
    if (history.length === 0) continue;
    const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
    const latest = sorted[sorted.length - 1];
    if (latest.last == null || latest.prev_close == null || latest.prev_close === 0) continue;
    if (!asOfDate || latest.date > asOfDate) asOfDate = latest.date;
    const pct_change_today = ((latest.last - latest.prev_close) / latest.prev_close) * 100;
    rows.push({
      ticker,
      pct_change_today: Number(pct_change_today.toFixed(2)),
      // Same-day options premium sentiment (dollar premium in trades UW
      // classifies as bullish vs bearish) and share volume - also zero-lag,
      // from the same capture as last/prev_close above. null when UW's
      // ~5-day premium window didn't happen to cover today for this ticker.
      volume: latest.volume ?? null,
      bullish_premium: latest.bullish_premium ?? null,
      bearish_premium: latest.bearish_premium ?? null
    });
  }
  return { fecha: asOfDate, ranking: rows.sort((a, b) => b.pct_change_today - a.pct_change_today) };
}

function buildPayload() {
  const flowScoreHistory = loadJson(path.join(cacheDir, 'institutional-flow-score.json'), []);
  const fedLiquidity = loadJson(path.join(cacheDir, 'fed-liquidity.json'), []);
  const marketRisk = loadJson(path.join(cacheDir, 'market-risk.json'), []);
  const cot = loadJson(path.join(cacheDir, 'cot-positioning.json'), []);
  const alerts = loadJson(path.join(cacheDir, 'fund-flow-alerts.json'), []);

  const latestScore = flowScoreHistory[flowScoreHistory.length - 1];
  if (!latestScore) return null;

  const latestLiquidity = fedLiquidity[fedLiquidity.length - 1];
  const weekAgoLiquidity = fedLiquidity.length > 0 ? weekAgoEntry(fedLiquidity) : null;

  const latestRisk = marketRisk[marketRisk.length - 1];
  const weekAgoRisk = marketRisk.length > 0 ? weekAgoEntry(marketRisk) : null;

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
    // Raw levels + 7d deltas, not just the compressed -2..+2 score - the
    // score alone can't tell the model whether "dollar: 0" means genuinely
    // flat or two offsetting moves that netted out.
    mercado_riesgo: latestRisk ? {
      vix: latestRisk.vix,
      vix_delta_7d: weekAgoRisk ? latestRisk.vix - weekAgoRisk.vix : null,
      hy_oas: latestRisk.hy_oas,
      hy_oas_delta_7d: weekAgoRisk ? latestRisk.hy_oas - weekAgoRisk.hy_oas : null,
      ig_oas: latestRisk.ig_oas,
      ig_oas_delta_7d: weekAgoRisk && latestRisk.ig_oas != null && weekAgoRisk.ig_oas != null
        ? latestRisk.ig_oas - weekAgoRisk.ig_oas : null,
      hy_ig_spread_differential: latestRisk.ig_oas != null ? latestRisk.hy_oas - latestRisk.ig_oas : null,
      dxy: latestRisk.dxy,
      dxy_delta_7d: weekAgoRisk ? latestRisk.dxy - weekAgoRisk.dxy : null,
      us10y: latestRisk.us10y,
      us10y_delta_7d: weekAgoRisk ? latestRisk.us10y - weekAgoRisk.us10y : null,
      real_yield_10y: latestRisk.real_yield_10y,
      real_yield_10y_delta_7d: weekAgoRisk && latestRisk.real_yield_10y != null && weekAgoRisk.real_yield_10y != null
        ? latestRisk.real_yield_10y - weekAgoRisk.real_yield_10y : null
    } : null,
    gamma_regime: buildGammaSnapshot(),
    etf_flows: {
      spy_net_flow: latestScore.inputs?.spy_net_flow ?? null,
      qqq_net_flow: latestScore.inputs?.qqq_net_flow ?? null,
      iwm_net_flow: latestScore.inputs?.iwm_net_flow ?? null,
      total_net_flow: latestScore.inputs?.etf_net_flow_total ?? null,
      // Ranked by net_flow_5d descending: first entries = mayor entrada de
      // dinero acumulada, últimas entradas = mayor salida - úsalo para
      // identificar rotación sectorial, no solo el agregado de índices.
      // fecha_dato = la fecha real que reporta UW para este net_flow (NO
      // necesariamente "fecha", que es la de gamma/mercado_riesgo) - suele
      // llegar ~1 día rezagada, es esa fecha la que hay que citar, no asumir
      // que es de hoy.
      fecha_dato: loadJson(path.join(cacheDir, 'fund-flow-SPY.json'), []).slice(-1)[0]?.net_flow_date ?? null,
      ranking_sectorial_5d: buildSectorFlowRanking()
    },
    // Variación % de precio de HOY (mismo día que gamma_regime, sin rezago)
    // para los mismos tickers de etf_flows - NO es flujo confirmado, es
    // acción de precio. Sirve para plantear una hipótesis de rotación del
    // día y cruzarla contra ranking_sectorial_5d (que sí es flujo real pero
    // de ayer) para ver si hay continuidad o divergencia.
    rotacion_precio_hoy: buildSectorPriceAction(),
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

async function callGemini(userContent) {
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

async function callClaude(userContent) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1000,
      // This is a short formatting/synthesis task, not a reasoning-heavy one -
      // extended thinking (on by default for Sonnet 5) was eating the token
      // budget itself and truncating the actual narrative mid-sentence.
      thinking: { type: 'disabled' },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }]
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude API HTTP ${res.status}: ${errText}`);
  }

  const json = await res.json();
  // find() instead of content[0] for resilience even with thinking disabled -
  // cheap insurance against future response-shape changes.
  const textBlock = json.content?.find(b => b.type === 'text');
  if (!textBlock?.text) throw new Error(`Claude response missing text: ${JSON.stringify(json)}`);
  return textBlock.text.trim();
}

async function callLLM(payload) {
  const userContent = `Datos de hoy:\n${JSON.stringify(payload, null, 2)}\n\nGenerá el análisis institucional de hoy con estos datos.`;
  return PROVIDER === 'claude' ? callClaude(userContent) : callGemini(userContent);
}

async function run() {
  if (!ANTHROPIC_API_KEY && !GEMINI_API_KEY) {
    console.error('Missing both ANTHROPIC_API_KEY and GEMINI_API_KEY in .env - need at least one.');
    process.exit(1);
  }

  const payload = buildPayload();
  if (!payload) {
    console.error('No institutional-flow-score.json data yet - run score:daily first.');
    process.exit(1);
  }

  const narrative = await callLLM(payload);
  const modelUsed = PROVIDER === 'claude' ? CLAUDE_MODEL : GEMINI_MODEL;

  const entry = {
    date: payload.fecha,
    narrative,
    generated_at: new Date().toISOString(),
    inputs: payload
  };

  const existing = loadJson(outputPath, []);
  const withoutToday = existing.filter(e => e.date !== entry.date);
  withoutToday.push(entry);
  withoutToday.sort((a, b) => a.date.localeCompare(b.date));
  fs.writeFileSync(outputPath, JSON.stringify(withoutToday, null, 2), 'utf8');

  console.log(`Institutional analysis for ${entry.date} (${modelUsed}):\n${narrative}`);
}

// Exported so scripts/export-cowork-prompt.js can reuse the exact live
// SYSTEM_PROMPT without duplicating/hand-copying it (and drifting out of
// sync with what production actually sends the LLM). Guarded by
// require.main so `require`-ing this file for that doesn't also fire off a
// real LLM call.
module.exports = { SYSTEM_PROMPT, buildPayload };

if (require.main === module) {
  run().catch(err => {
    console.error('Failed to generate institutional analysis:', err.message);
    process.exit(1);
  });
}
