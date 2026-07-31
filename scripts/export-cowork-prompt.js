const fs = require('fs');
const path = require('path');
const { SYSTEM_PROMPT } = require('./generate-institutional-analysis');

// Regenerates docs/cowork-institutional-analysis-prompt.txt so it always
// mirrors the exact live prompt + the exact payload Sonnet actually received
// for its most recent institutional-analysis entry - pulled straight from
// cache/institutional-analysis.json's `inputs` field instead of recomputing
// buildPayload() separately, which could drift from what was really sent if
// run at a different moment against different cache state.
//
// Usage: node scripts/export-cowork-prompt.js
// Run this after the day's institutional-analysis has generated (chained
// after macro-liquidity-refresh, see .circleci/config.yml) to get the
// freshest comparison payload for pasting into Fable/Cowork.

const cacheDir = path.join(__dirname, '..', 'cache');
const docsDir = path.join(__dirname, '..', 'docs');
const analysisPath = path.join(cacheDir, 'institutional-analysis.json');
const outputPath = path.join(docsDir, 'cowork-institutional-analysis-prompt.txt');

function loadJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function run() {
  const entries = loadJson(analysisPath, []);
  if (entries.length === 0) {
    console.error(`No entries in ${analysisPath} yet - run npm run analysis:daily first.`);
    process.exit(1);
  }
  const latest = [...entries].sort((a, b) => a.date.localeCompare(b.date))[entries.length - 1];

  const userMessage = `Datos de hoy:\n${JSON.stringify(latest.inputs, null, 2)}\n\nGenerá el análisis institucional de hoy con estos datos.`;

  const doc = `CÓMO USAR ESTE ARCHIVO
=======================
Esto es exactamente lo mismo que recibe el agente automático (Claude Sonnet 5,
vía scripts/generate-institutional-analysis.js) para generar el análisis
institucional diario del dashboard. Pegá las DOS secciones de abajo en Claude
Cowork como contexto/instrucciones, en este orden, para comparar cómo
interpreta los mismos datos.

No sé con certeza si Cowork puede navegar a la página del dashboard por su
cuenta - por eso este archivo te da los datos ya pegados como texto, así la
comparación no depende de eso.

Datos generados: ${latest.date} (correr scripts/generate-institutional-analysis.js
de nuevo mañana regenera un payload nuevo - correr este script de vuelta
regenera esta comparación con datos más frescos).


SECCIÓN 1 — INSTRUCCIONES DEL SISTEMA (system prompt)
=======================================================
${SYSTEM_PROMPT}


SECCIÓN 2 — MENSAJE DEL USUARIO (datos de hoy + instrucción final)
=====================================================================
${userMessage}
`;

  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(outputPath, doc, 'utf8');
  console.log(`Wrote ${outputPath} (data as of ${latest.date}).`);
}

run();
