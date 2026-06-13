const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageNumber, Footer, PageBreak
} = require("docx");

const border = { style: BorderStyle.SINGLE, size: 1, color: "BBBBBB" };
const borders = { top: border, bottom: border, left: border, right: border };
const CW = 9360;

const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const P = (t, opts = {}) => new Paragraph({
  spacing: { after: 120 },
  children: [new TextRun({ text: t, bold: opts.bold, italics: opts.italics, color: opts.color })]
});
const BULLET = (runs) => new Paragraph({
  numbering: { reference: "bullets", level: 0 },
  spacing: { after: 60 },
  children: runs.map(r => new TextRun(r))
});
const pb = () => new Paragraph({ children: [new PageBreak()] });

function cell(text, w, opts = {}) {
  const runs = Array.isArray(text) ? text : [{ text: String(text) }];
  return new TableCell({
    borders, width: { size: w, type: WidthType.DXA },
    shading: opts.fill ? { fill: opts.fill, type: ShadingType.CLEAR } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({
      children: runs.map(r => new TextRun({ size: 18, ...r, bold: r.bold ?? opts.bold }))
    })]
  });
}
function table(widths, rows) {
  return new Table({
    width: { size: CW, type: WidthType.DXA },
    columnWidths: widths,
    rows: rows.map((r, i) => new TableRow({
      tableHeader: i === 0,
      children: r.map((c, j) => cell(c, widths[j], i === 0 ? { fill: "1F3354", bold: true } : {}))
    }))
  });
}
const W = (t) => [{ text: t, color: "FFFFFF" }];
const OK = [{ text: "✔ VERIFICADO", bold: true, color: "1E8449" }];
const PARC = [{ text: "◐ PARCIAL", bold: true, color: "E67E22" }];

const children = [];

// Portada
children.push(
  new Paragraph({ spacing: { before: 2000, after: 200 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "AUDITORÍA CUANTITATIVA — V2", bold: true, size: 52 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 },
    children: [new TextRun({ text: "Re-auditoría post-corrección — Motor GEX / VEX / Dealer Analysis", bold: true, size: 32, color: "1F3354" })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 },
    children: [new TextRun({ text: "EXPOSURE Dashboard — gexvex.dapintegratedsolutions.com", size: 22, italics: true })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 1600 },
    children: [new TextRun({ text: "Fecha: 12 de junio de 2026 · Auditoría original: 11-jun-2026", size: 22 })] }),
  P("Alcance: verificación independiente de las 13 correcciones declaradas en PLAN_CORRECCION_AUDITORIA.md contra (1) el código fuente post-corrección completo (gex-engine.ts, route.ts, snapshots/route.ts, page.tsx, GammaMatrix.tsx, backend/main.py, dealer-builder.js), (2) re-ejecución de la batería de validación numérica (7 re-tests), y (3) datos en vivo del deploy en producción con mercado abierto (12-jun-2026, ~11:15 ET)."),
  pb()
);

// 1. Resumen ejecutivo
children.push(H1("1. Resumen ejecutivo"));
children.push(P("Las correcciones son reales y están operativas en producción. De los 13 ítems del plan, 12 quedan verificados de forma independiente a nivel de código, test numérico y/o datos en vivo; 1 (sanitización de IV) queda parcial porque implementa el filtro de rango pero no la reparación por paridad call/put que era la otra mitad del hallazgo C4 original. Los cinco errores críticos de la auditoría v1 (vanna con √T extra, signo dealer invertido en calls, mezcla de convenciones sin dato UW, IV basura sin filtrar, gamma flip en el primer cruce) ya no existen en el código desplegado."));
children.push(P("Evidencia en vivo más contundente (SPY, vencimiento 15-jun, spot 742.68): los contratos con IV corrupta llegan ahora con IV=0 y GEX=0 en lugar de fabricar gamma; y el Gamma Flip se publica en 739.85, a −0.38% del spot — en la v1 el mismo cálculo daba desviaciones de −8% (SPY) y −19% (GOOGL)."));
children.push(P("Lo que queda pendiente es de segunda orden pero no es cosmético: (1) la sanitización descarta el lado ITM corrupto en lugar de repararlo, así que el perfil ITM sigue ausente del mapa y la gamma de call y put al mismo strike sigue difiriendo hasta 2.5× dentro del rango aceptado — la paridad call/put con una sola gamma por strike sigue siendo la mejora de mayor impacto disponible; (2) en modo DEALER la vanna pasa por Math.abs(), que destruye su signo intrínseco (correcto para gamma, incorrecto para vanna); (3) RAW GEX y RAW VEX siguen asumiendo posicionamientos dealer contradictorios; (4) la persistencia server-side usa un Map en memoria del proceso, que en Vercel (serverless multi-instancia) se fragmenta y se vacía en cada cold start. Con estos cuatro puntos resueltos, el sistema queda a nivel de las herramientas comerciales de referencia en su núcleo GEX/VEX."));
children.push(P("Veredicto operativo: el núcleo GEX (RAW y DEALER), King Node, Net GEX y Gamma Flip son utilizables para lectura estructural en SPY/QQQ y, gracias a los parámetros grid-aware, ahora también en GOOGL/TSLA. El lado ITM ausente sigue recomendando cautela en lecturas de Net GEX absoluto, y la VEX Matrix es confiable en RAW pero no en DEALER hasta corregir el abs().", { bold: true }));
children.push(pb());

// 2. Scores
children.push(H1("2. Métricas de evaluación — antes y después"));
children.push(table(
  [2200, 1100, 1100, 4960],
  [
    [W("Dimensión"), W("v1"), W("v2"), W("Justificación v2")],
    ["Teoría", "6 / 10", "8 / 10", "VEX correctamente definido como exposición a vanna (∂Δ/∂IV, alineado con Heatseeker/Skylit); riesgo multiplicativo con signo del King (pin ⇒ riesgo bajo); presión en unidades comparables. Resta: convención de signo de vanna inconsistente entre RAW y DEALER, y umbrales (0.05/0.20, HHI 0.3/0.6, EMA 0.4/0.7) sin calibración empírica."],
    ["Implementación", "4 / 10", "7 / 10", "Motor único gex-engine.ts (r=4.5%, T a 16:00 ET, vanna exacta verificada ratio 1.0000 vs diferencias finitas); todas las copias eliminadas; hardcodes fuera; lock en build. Resta: abs() sobre vanna en DEALER, sanitización local de GammaMatrix sin límite inferior, README declara paridad call/put que el código no contiene."],
    ["Precisión", "3 / 10", "6 / 10", "Flip a −0.4% del spot en vivo (antes −8/−19%); IV basura ya no fabrica Kings; T sin error de 8 h en 0DTE. Resta: lado ITM descartado (no reparado), γcall/γput hasta 2.5× distintas al mismo strike dentro del rango válido, OI con rezago de 1 día (límite de Yahoo)."],
    ["Robustez", "3 / 10", "6 / 10", "Métricas invariantes al zoom (cadena completa, HHI, straddle); persistencia server-side con EMA continua; parámetros relativos al grid; lock anti-DoS. Resta: store de snapshots en memoria de proceso (se pierde en cold starts y se fragmenta entre instancias serverless), alimentación dependiente de que un cliente tenga la página abierta, y caché aguas arriba que puede servir respuestas obsoletas para URLs repetidas."],
    ["Utilidad operativa", "5 / 10", "7 / 10", "GEX RAW/DEALER, King, Net y Flip utilizables en SPY/QQQ/GOOGL/TSLA ≥0DTE con las cautelas del ITM; escenarios y S/R ahora coherentes en grids de 2.5/5; VEX Matrix utilizable en RAW. DEALER VEX y Net GEX absoluto requieren las correcciones residuales."]
  ]
));
children.push(pb());

// 3. Verificación de los 13 items
children.push(H1("3. Verificación independiente de los 13 ítems del plan"));
children.push(P("Cada ítem fue verificado contra el código real (no contra lo declarado), re-ejecutando los tests de validación y contrastando con producción."));
children.push(table(
  [700, 2900, 1500, 4260],
  [
    [W("Ítem"), W("Corrección declarada"), W("Estado"), W("Evidencia de verificación")],
    ["1", "Vanna = −φ(d1)·d2/σ (C1)", OK, "gex-engine.ts calcVanna; re-test vs diferencia finita: ratio 1.0000 en 0DTE/2DTE/30d/180d. Cero ocurrencias del patrón viejo −(vega·d2)/(S·σ)."],
    ["2", "Signo dealer: −clientBias·|GEX| (C2)", OK, "4 bloques (page.tsx ×3, GammaMatrix ×1). Re-test de 4 escenarios cliente: todos OK (v1 fallaban los 2 de calls)."],
    ["3", "Default sin dato UW: call −1 / put +1 (C3)", OK, "clientBias = type==='CALL' ? −1 : 1 antes del lookup UW; prior SqueezeMetrics correcto; display 'prior −/+'."],
    ["4", "Sanitización IV [3%, 400%] (C4+C5)", PARC, "Filtro verificado en route.ts, backend y producción (contratos basura → iv:0, gex:0; heurística /100 eliminada, IVs 137–575% ya no se destruyen). PARCIAL: no repara IV desde mid-price ni unifica gamma por strike vía paridad — el lado ITM sigue ausente (ver R1). El README declara 'paridad call/put OTM' que el código no implementa."],
    ["5", "Gamma flip: cruce más cercano (C7)", OK, "findGammaFlip recopila todos los cruces y elige el más cercano; bug de bisección (gexPrev por cierre) también corregido. Producción: SPY 3DTE flip 739.85 / spot 742.68 = −0.38%. Re-test perfil bicruce: devuelve 695, no 612."],
    ["6", "Parámetros grid-aware (C6)", OK, "gridStep = mediana de diferencias; cadena de absorción ≤2·gridStep (re-test: TSLA/GOOGL ya forman cadenas de 3 nodos); vacío >gridStep; near-spot 1.5% del spot; King dist en múltiplos de gridStep; S/R sin filtro gex>0 (0 ocurrencias del filtro viejo)."],
    ["7", "Motor único compartido (M1–M3)", OK, "gex-engine.ts importado por route.ts, page.tsx y GammaMatrix; backend replica r=0.045 y T=20:30 UTC; cero copias de la fórmula vieja."],
    ["8", "Presión VEX/GEX unidades comparables (C8)", OK, "ratio = |netVex|/|netGex| — $ de delta por 1 pt de vol vs $ por 1% de spot (los ×0.01 se cancelan); umbrales 0.05/0.20; display 0.XXX×. Económicamente interpretable."],
    ["9", "Persistencia server-side + EMA (6.6)", OK, "POST /api/snapshots con EMA continua exp(−Δt·ln2/45min); side-effect movido de useMemo a useEffect (fix StrictMode). Limitación de infraestructura: ver R4."],
    ["10", "Riesgo V2 multiplicativo (6.5)", OK, "riesgo = 1−(1−frag·react)(1−inest·prox); react = max(0,−netGEX)/Σ|GEX| se anula en régimen positivo; prox normalizada al straddle ATM. Re-test pin (spot=king positivo, EMA alta): 0.20 (Bajo) ✓; gamma negativa + King inestable: 0.79 (Alto) ✓."],
    ["11", "Métricas invariantes a la UI (6.1/6.3/6.9)", OK, "Dominancia y sesgo sobre sumAbsAllGex (cadena completa); etiqueta de sesgo con signo ('Positivo/Negativo Dominante'); densidad por HHI normalizado; compresión en unidades de straddle. Ya no dependen del Window ±10/±20/±30."],
    ["12", "Dealer-builder sin path dependency (7.1)", OK, "Cierres proporcionales al split vigente; day-0 con prior 50/50; renormalización buy+sell=lastOI (verificado: caso GOOGL del doc da exactamente 14 353). Nota: el 'decay' por recencia del título no se implementó (ver R7)."],
    ["13", "Hardcodes, lock, labels (M4/M8/M9)", OK, "0 ocurrencias de '745'; lock booleano + guard Vercel + 429 en build route; labels '$ per 1% spot move', 'OI as-of', 'X of Y shown'."]
  ]
));
children.push(pb());

// 4. Evidencia en produccion
children.push(H1("4. Evidencia en producción (12-jun-2026, mercado abierto)"));
children.push(table(
  [2300, 3530, 3530],
  [
    [W("Verificación"), W("v1 (11-jun)"), W("v2 (12-jun, en vivo)")],
    ["IV corrupta (calls ITM)", "IV=1e-5 con gamma fabricada (QQQ King 718 con IV 1.18% y GEX 390M ficticios)", "SPY 15-jun: contratos basura devuelven impliedVolatility: 0, gamma 0, GEX 0 — descartados explícitamente, ya no fabrican nodos."],
    ["Gamma Flip", "SPY −8.1% del spot; GOOGL −19.4% (primer cruce del barrido)", "SPY 15-jun: flip 739.85 con spot 742.68 (−0.38%) — cruce relevante al régimen actual."],
    ["Heurística IV>1 → /100", "IVs legítimas de alas (137–575%) convertidas en 1.4–5.8% solo en frontend", "Eliminada; rango [3%, 400%] idéntico en backend, route y frontend."],
    ["T en 0DTE", "Medianoche UTC (error ~8 h); floors inconsistentes (0.5 d / 1e-4 años)", "calcT con 20:30 UTC en todos los consumidores (nota: 16:00 ET = 20:00 UTC en horario de verano; error residual fijo de 30 min, documentado y aceptable)."]
  ]
));
children.push(P("Observación de caché: una URL repetida (GOOGL exp 18-jun, consultada ayer) devolvió una respuesta byte a byte idéntica a la de ayer incluso con parámetro anti-caché (que el proxy normaliza y elimina). Una combinación nunca consultada devolvió datos frescos del código nuevo. Conviene revisar los headers de caché del proxy/CDN delante del API: el route declara force-dynamic, pero algo aguas arriba (o intermediarios del cliente) puede servir respuestas viejas a consumidores que repiten URLs.", { italics: true }));
children.push(pb());

// 5. Hallazgos residuales
children.push(H1("5. Hallazgos residuales (auditoría v2)"));
children.push(table(
  [700, 1100, 3300, 2130, 2130],
  [
    [W("ID"), W("Severidad"), W("Hallazgo"), W("Impacto"), W("Corrección")],
    ["R1", [{ text: "ALTA", bold: true, color: "E67E22" }],
      "La sanitización filtra pero no repara: contratos con IV fuera de rango se descartan (gex=0) en lugar de re-derivar la IV desde el mid-price; y no hay gamma única por strike vía paridad. En producción (SPY 15-jun): todo el lado call ITM ≤737 en cero, y al mismo strike 740 γcall=0.066 vs γput=0.026 (2.5×) — teóricamente idénticas.",
      "El perfil ITM sigue ausente del mapa; Net GEX y el balance call/put por strike siguen contaminados por ruido de datos dentro del rango aceptado; el Flip se calcula sobre un perfil asimétrico.",
      "Implementar lo planificado: IV implícita desde mid (Brent/Newton) cuando el rango falla y bid/ask existen; gamma por strike con la IV del contrato OTM (paridad). Es la mitad pendiente del ítem 4 y la mejora de mayor impacto disponible. 8–12 h."],
    ["R2", [{ text: "MEDIA", bold: true, color: "E67E22" }],
      "Modo DEALER aplica −clientBias × Math.abs(baseValue) también al VEX. Para GEX el abs es inocuo (γ·OI·S² siempre >0), pero la vanna tiene signo intrínseco propio (positivo OTM-call/ITM-put, negativo ITM-call/OTM-put vía d2): el abs lo destruye e impone que toda call sea +vanna y toda put −vanna.",
      "La VEX Matrix en modo DEALER asigna el signo equivocado a los contratos ITM; el netVex dealer y la Presión quedan distorsionados en cadenas con OI ITM relevante.",
      "dealerVex = −clientBias × vex (sin abs). Mantener abs solo para GEX o reescribir como −clientBias × γ·OI·S². 1–2 h."],
    ["R3", [{ text: "MEDIA", bold: true, color: "E67E22" }],
      "Convención de posicionamiento inconsistente entre matrices en modo RAW: GEX usa call + / put − (dealer largo calls, corto puts), pero VEX suma la vanna de calls y puts sin distinción de tipo — asume dealer largo todo.",
      "Las dos matrices RAW no son comparables entre sí: describen dos dealers distintos. La Presión VEX/GEX mezcla ambas convenciones.",
      "En RAW: vex_dealer = +vanna_call − vanna_put (misma convención que GEX). 1–2 h. (Hallazgo de la v1, sección 5, que no entró en el plan de 13 ítems.)"],
    ["R4", [{ text: "MEDIA", bold: true, color: "E67E22" }],
      "Persistencia server-side sobre Map en memoria del proceso Next.js. En Vercel/serverless: cada instancia tiene su propio store, los cold starts lo vacían y el balanceo fragmenta la serie. Además el POST lo dispara el navegador del usuario: sin pestañas abiertas no hay serie.",
      "La EMA de persistencia (insumo del Riesgo V2 vía 'inestabilidad') se resetea a 0.5 con frecuencia en producción: el riesgo oscila por infraestructura, no por mercado.",
      "Persistir en storage durable (Vercel KV/Redis/archivo en VPS) y alimentar con un cron server-side (cada 1–5 min) independiente de los clientes. 4–8 h."],
    ["R5", [{ text: "BAJA", bold: true, color: "F1C40F" }],
      "Sanitización local de GammaMatrix: sigma<=0 || sigma>4 (falta el límite inferior 0.03) y page.tsx replica el rango a mano en 3 puntos en vez de importar sanitizeIV() del motor.",
      "Hoy inocuo (el route ya entrega IV sanitizada), pero es defensa inconsistente: cualquier consumo futuro de datos crudos reintroduce el bug C4 silenciosamente.",
      "Reemplazar todos los checks manuales por sanitizeIV() del gex-engine. 1 h."],
    ["R6", [{ text: "BAJA", bold: true, color: "F1C40F" }],
      "Ítem 12 se titulaba 'decay' pero no hay ponderación por recencia en dealer-builder: un flujo de hace 6 meses pesa igual que el de ayer; y el prior de day-0 es 50/50 neutro en vez del prior por tipo (call −/put +) usado en el resto del sistema.",
      "El bias de contratos viejos refleja historia, no posicionamiento vigente; menor mientras la cobertura UW sea de contratos recientes.",
      "Ponderar ΔOI por exp(−edad/half-life≈20 días) y arrancar day-0 con el prior por tipo. 3–4 h."],
    ["R7", [{ text: "BAJA", bold: true, color: "F1C40F" }],
      "Calibraciones heurísticas sin respaldo empírico: Presión 0.05/0.20, HHI 0.3/0.6, EMA 0.4/0.7, half-life 45 min, dominancia 20/40/60.",
      "Las etiquetas cualitativas (Mixto, Compacta, Persistente…) pueden no discriminar regímenes reales.",
      "Backtest simple sobre snapshots históricos: distribución de cada métrica y percentiles 33/66 por ticker. 6–8 h."],
    ["R8", [{ text: "BAJA", bold: true, color: "F1C40F" }],
      "calcT fija 20:30 UTC todo el año; en horario de verano 16:00 ET = 20:00 UTC (error fijo +30 min). Documentado en el código como aproximación deliberada.",
      "En 0DTE a última hora el T queda ~10–15% alto; gamma ATM levemente subestimada cerca del cierre.",
      "Opcional: detectar DST por fecha (offset abr–oct = 20:00). 1 h."]
  ]
));
children.push(pb());

// 6. Recomendaciones
children.push(H1("6. Recomendaciones — siguiente iteración"));
children.push(table(
  [700, 5260, 1300, 2100],
  [
    [W("#"), W("Acción"), W("Prioridad"), W("Esfuerzo")],
    ["1", "Paridad call/put + re-derivación de IV desde mid-price (cierra R1, completa el ítem 4 original). Corregir también el README que la declara implementada.", "Alta", "8–12 h"],
    ["2", "Quitar Math.abs() de la vanna en DEALER y unificar convención de signo VEX en RAW (+vanna_call − vanna_put) — cierra R2 y R3 y deja GEX/VEX con el mismo dealer implícito.", "Alta", "2–4 h"],
    ["3", "Persistencia durable (KV/Redis) + cron server-side de snapshots — cierra R4 y estabiliza el Riesgo V2 en producción.", "Media", "4–8 h"],
    ["4", "Centralizar sanitizeIV() en todos los consumidores (R5).", "Media", "1 h"],
    ["5", "Decay por recencia y prior por tipo en dealer-builder (R6).", "Baja", "3–4 h"],
    ["6", "Calibración empírica de umbrales con histórico de snapshots (R7) y ajuste DST de calcT (R8).", "Baja", "7–9 h"],
    ["7", "Revisar política de caché del proxy/CDN delante de /api/options (respuestas obsoletas para URLs repetidas observadas durante la auditoría).", "Baja", "1–2 h"]
  ]
));
children.push(P("Total estimado: 26–40 h. Con los puntos 1 y 2 (10–16 h) el sistema cierra todas las brechas matemáticas conocidas; 3 y 4 consolidan la robustez operativa."));
children.push(pb());

// 7. Veredicto
children.push(H1("7. Veredicto final"));
children.push(P("La re-auditoría confirma que el equipo ejecutó el plan con fidelidad: los cinco errores críticos de la v1 están corregidos en el código y verificados en producción con mercado abierto, el motor está unificado, las métricas del Dealer Analysis ya no dependen de la UI y el Riesgo V2 se comporta correctamente en el escenario de pin que antes invertía. La distancia entre lo declarado y lo implementado es mínima y está documentada en este informe (paridad call/put declarada pero no implementada; 'decay' del dealer-builder no implementado)."));
children.push(P("Estado operativo: apto para lectura estructural en SPY, QQQ, GOOGL y TSLA con dos cautelas activas — el Net GEX absoluto está sesgado por la ausencia del lado ITM descartado (R1), y el modo DEALER de la VEX Matrix no debe usarse hasta retirar el abs() de la vanna (R2). Scores: Teoría 8, Implementación 7, Precisión 6, Robustez 6, Utilidad operativa 7 (desde 6/4/3/3/5)."));

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 21 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 30, bold: true, font: "Arial", color: "1F3354" },
        paragraph: { spacing: { before: 280, after: 200 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 25, bold: true, font: "Arial", color: "2C4A77" },
        paragraph: { spacing: { before: 220, after: 140 }, outlineLevel: 1 } }
    ]
  },
  numbering: {
    config: [
      { reference: "bullets",
        levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] }
    ]
  },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    footers: {
      default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: "Auditoría GEX/VEX v2 — ", size: 16, color: "888888" }),
          new TextRun({ size: 16, color: "888888", children: [PageNumber.CURRENT] })
        ] })] })
    },
    children
  }]
});

Packer.toBuffer(doc).then(b => {
  fs.writeFileSync("Auditoria_GEX_VEX_v2_post_correccion.docx", b);
  console.log("OK", b.length, "bytes");
});
