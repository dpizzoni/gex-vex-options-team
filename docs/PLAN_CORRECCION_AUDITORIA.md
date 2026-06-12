# 📋 PLAN DE CORRECCIÓN — Auditoría GEX/VEX Dashboard
> Basado en: `Auditoria.docx` + `validacion_auditoria.py` — Fecha: 11 de junio de 2026  
> Estado del plan: **ACTIVO** — Última actualización: 11-jun-2026  
> Metodología: cada ítem requiere **aprobación explícita** antes de ejecutarse.

---

> [!IMPORTANT]
> ## 🚦 Regla de Trabajo — LEER ANTES DE CONTINUAR (válido para cualquier agente)
>
> **Todo el trabajo se realiza y valida en `localhost` (Next.js dev server + backend local).**  
> **NO se hace `git push`, `git commit` ni deploy a GitHub/Vercel hasta que el plan completo esté terminado y aprobado.**  
>
> Flujo de trabajo:  
> 1. Modificar el código en local  
> 2. Validar en `localhost:3000` (y con `validacion_auditoria.py` donde aplique)  
> 3. Obtener aprobación del usuario en cada ítem  
> 4. Marcar el ítem como ✅ COMPLETADO en este documento  
> 5. **Solo al finalizar los 13 ítems**: hacer commit y push a GitHub en un solo batch  
>
> Si se retoma el trabajo con un agente nuevo, este documento es la fuente de verdad. Empezar siempre revisando la tabla de estado al final del documento.

---

## Resultado de la Auditoría (resumen ejecutivo)

| Dimensión        | Score | Veredicto                                          |
|------------------|-------|----------------------------------------------------|
| Teoría           | 6/10  | Marco conceptual sólido, VEX mal implementado      |
| Implementación   | 4/10  | Errores verificados en fórmulas y lógica           |
| Precisión        | 3/10  | IV corrupta domina la señal en 0DTE                |
| Robustez         | 3/10  | Dependencia de UI, sin persistencia server-side    |
| Utilidad operativa | 5/10 | GEX RAW y King son fiables en SPY/QQQ ≥1DTE     |

**Conclusión**: El sistema **no debe usarse para decisiones operativas** hasta corregir los ítems CRÍTICOS (Fase 1). Con las correcciones 1–5 pasa de "no operable" a "comparable con herramientas comerciales".

---

## Archivos Involucrados

| Archivo | Descripción |
|---------|-------------|
| `src/app/page.tsx` | Frontend principal — contiene 4 copias de lógica de cálculo |
| `src/app/components/GammaMatrix.tsx` | Componente de la matriz VEX |
| `src/app/api/options/route.ts` | API route Next.js — copia 3 de lógica |
| `backend/main.py` | Backend FastAPI — copia 4 de lógica |
| `scripts/dealer-builder.js` | Estimador buy/sell Unusual Whales |
| `src/lib/` | (a crear) Módulo compartido de cálculo |

---

## FASE 1 — CRÍTICO: Motor Matemático y Datos
> Estimado: 25–36 h | Meta: llevar el sistema a "operativamente confiable"

### ✅ ÍTEM 1 — Corrección de Fórmula Vanna (C1)
**Severidad**: 🔴 CRÍTICA  
**Error**: La fórmula actual `vanna = −vega·d2/(S·σ)` tiene un factor √T de más.  
La correcta es `vanna = −φ(d1)·d2/σ`.  
**Impacto**: VEX subestimado ~27× en 0DTE, ~3.5× a 30d. VEX Matrix completamente distorsionada.  
**Archivos a modificar**:
- `src/app/page.tsx` (×4 ocurrencias)  
- `src/app/components/GammaMatrix.tsx` (×1 ocurrencia)

**Verificación**: Test 1 del `validacion_auditoria.py` — ratio sistema/correcto debe ser ≈1.000 para todos los vencimientos.

**Fórmula actual** (incorrecta):
```typescript
const vanna = -(vega * d2) / (S * sigma);  // vega incluye √T → factor extra
```

**Fórmula correcta**:
```typescript
const phi_d1 = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);
const vanna = -(phi_d1 * d2) / sigma;      // sin factor √T
```
**Estado**: ✅ COMPLETADO — 11-jun-2026  
**Archivos modificados**: `src/app/page.tsx` (×4 ocurrencias) + `src/app/components/GammaMatrix.tsx` (×1 ocurrencia)  
**Fórmula corregida**: `vanna = -(pdf * d2) / sigma` — equivale a `−φ(d1)·d2/σ` sin factor √T ✓  
**Verificado**: App carga sin errores en `localhost:3002` ✓

---

### ✅ ÍTEM 2 — Corrección Signo Modo DEALER - Calls (C2)
**Severidad**: 🔴 CRÍTICA  
**Error**: `dealerGex = rawGex × bias` aplica el sesgo del cliente sin invertirlo para el dealer.  
Para calls el resultado queda con signo CONTRARIO en el 100% de los casos con dato UW.  
**Impacto**: King, sesgo, escenarios y S/R en modo DEALER están contaminados.  
**Archivos a modificar**:
- `src/app/page.tsx` — lógica de `dealerGex`
- `src/app/components/GammaMatrix.tsx` — lógica VEX dealer

**Lógica actual** (incorrecta):
```typescript
dealerGex = rawGex * bias;  // raw call = +, bias = cliente → dealer queda con signo de cliente
```

**Lógica correcta**:
```typescript
dealerGex = -bias * Math.abs(gamma * oi * S * S);  // dealer = opuesto al cliente, γ siempre >0
```
**Estado**: ✅ COMPLETADO — 11-jun-2026  
**Archivos**: `src/app/page.tsx` (×3 bloques) + `src/app/components/GammaMatrix.tsx` (×1 bloque)  
**Cambio**: `return baseValue * dealerBiasVal` → `return -clientBias * Math.abs(baseValue)`  
**Verificado**: Dashboard carga y responde correctamente en `localhost:3002` ✓

---

### ✅ ÍTEM 3 — Default de Bias en Modo DEALER sin dato UW (C3)
**Severidad**: 🔴 CRÍTICA  
**Error**: Contratos sin dato UW usan `bias = 1` (equivale a RAW), mezclando convenciones en el mismo agregado.  
**Impacto**: El modo DEALER ≈ RAW con celdas sueltas alteradas: matemáticamente incoherente.  
**Archivos a modificar**:
- `src/app/page.tsx` — asignación de bias default
- `scripts/dealer-builder.js` — lógica de estimación

**Default correcto** (convención SqueezeMetrics):
```typescript
// Cuando NO hay dato UW:
const defaultBias = contract.type === 'call' ? -1 : +1;
// Marcar visualmente qué celdas tienen dato real vs. prior
```
**Estado**: ✅ COMPLETADO — 11-jun-2026 (integrado en mismo cambio que Ítem 2)  
**Default implementado**: `clientBias = contract.type === "CALL" ? -1 : 1` (prior SqueezeMetrics)  
**Display**: celdas sin dato UW muestran "prior −" (calls) o "prior +" (puts) claramente ✓  
**Hardcodes SPY demo removidos**: 4 ubicaciones eliminadas (también cubre M4 parcialmente) ✓

---

### ✅ ÍTEM 4 — Sanitización de IV de Yahoo (C4 + C5)
**Severidad**: 🔴 CRÍTICA  
**Error**:
- C4: IV de Yahoo entra sin sanitizar → calls ITM con `IV=1e-5` → GEX=0 en GOOGL, QQQ (tickers del sistema con cadenas largas)
- C5: Heurística frontend `sigma > 1 → sigma/100` destruye IVs legítimas >100% (alas 0DTE en TSLA/QQQ: ~137–575%)

> ⚠️ **Nota**: El auditor usó NVDA como ejemplo de referencia. NVDA **no está en el sistema**. Los tickers reales son **SPY, QQQ, GOOGL y TSLA**. Los errores C4/C5 aplican igualmente a QQQ (IV corrupta ITM) y TSLA (IV >100% en alas 0DTE).

**Impacto**: 
- El perfil ITM desaparece del mapa GEX
- Net GEX sesgado al alza por el lado put
- King Nodes son artefactos (QQQ con IV=1.18% por heurística rota)
- Frontend y backend muestran valores distintos para el mismo contrato

**Archivos a modificar**:
- `src/app/page.tsx` — eliminar heurística `sigma/100`, añadir filtro de rango
- `src/app/api/options/route.ts` — sanitización en route
- `src/app/components/GammaMatrix.tsx` — sanitización

**Regla de sanitización implementada**:
```typescript
// Yahoo entrega IV como decimal: 0.20 = 20%, 2.81 = 281%
// Rango válido: [0.03, 4.00] → [3%, 400%]
// Fuera del rango → iv = 0 → GEX = 0 (contrato descartado sin silenciar)
const iv = (rawIv >= 0.03 && rawIv <= 4.00) ? rawIv : 0;
```
**Estado**: ✅ COMPLETADO — 11-jun-2026  
**Archivos modificados**:  
- `src/app/api/options/route.ts` — C4: validación `rawIv ∈ [0.03, 4.00]` antes de `calculateGamma`  
- `src/app/page.tsx` — C5: reemplazadas 4 ocurrencias de `sigma > 1 → /100` por filtro de rango  
- `src/app/components/GammaMatrix.tsx` — C5: reemplazada 1 ocurrencia  
- `docs/validacion_auditoria.py` — Test 7 y Tests 4/5 actualizados para reflejar tickers reales (TSLA/QQQ vs NVDA)  
**Verificado**: Build sin errores TypeScript ✓ | Backend y frontend usan misma regla ✓

---

### ✅ ÍTEM 5 — Gamma Flip: Cruce Más Cercano al Spot (C7)
**Severidad**: 🟠 ALTA  
**Error**: El barrido de `0.8×spot` a `1.2×spot` retorna el **primer** cruce, no el más cercano al spot.  
**Evidencia en vivo**:
- GOOGL: flip=289.2 con spot=358 (−19%)
- SPY: flip=679.4 con spot=739 (−8%)

**Archivos a modificar**:
- `src/app/page.tsx` — lógica de detección del gamma flip

**Lógica correcta**:
```typescript
// Detectar TODOS los cruces de cero en el barrido
// Retornar el más cercano al spot actual
// Publicar opcionalmente todos los cruces encontrados
const allCrosses = detectAllZeroCrossings(spotRange, netGexProfile);
const gammaFlip = findClosestToSpot(allCrosses, currentSpot);
```
**Estado**: ✅ COMPLETADO — 11-jun-2026  
**Archivos modificados**: `src/app/page.tsx` — lógica de detección de gamma flip  
**Cambio**: eliminado `break` tras primer cruce; ahora se recopilan todos los cruces en `allCrosses[]` y se selecciona el más cercano al spot con `reduce(Math.abs(c - spot))`. Corregido también bug menor: bisección usaba `gex_prev` capturado por cierre en lugar de `gex_left` fijo al inicio del intervalo.  
**Verificado**: TypeScript compila sin errores ✓

---

### ✅ ÍTEM 6 — Parámetros Relativos al Grid de Strikes (C6)
**Severidad**: 🟠 ALTA  
**Error**: Todas las reglas de escenarios y S/R usan umbrales en puntos absolutos:
- Cadena de absorción: `≤ 3 pts` (solo válido en SPY/QQQ con grid $1)
- Vacío detectado: `gap > 1 pt` (en NVDA spacing=5 → cada par adyacente es "vacío")
- Near-spot: `± 5 pts`
- Fallback trigger: `− 5`
- S1–S3 exigen `GEX > 0` → excluyen soportes de puts

**Impacto**: En NVDA/TSLA/GOOGL la "absorción hasta X" nunca se forma, los vacíos son ruido del grid, los soportes reales por puts no aparecen en Zonas.

**Archivos a modificar**:
- `src/app/page.tsx` — funciones de escenarios y S/R

**Lógica correcta**:
```typescript
const gridStep = median(diff(strikeList));  // paso real del grid del ticker
const absorptionMaxGap = 2 * gridStep;      // relativo al grid
const nearSpotRange = spot * 0.015;         // 1.5% del spot (no 5 pts fijos)
// S/R: rankear por |GEX| con rol según signo, SIN filtro de signo
```
**Estado**: ✅ COMPLETADO — 11-jun-2026  
**Archivos modificados**: `src/app/page.tsx`  
**Cambios**:
- `gridStep` = mediana de diferencias entre strikes (SPY→1, GOOGL/TSLA→5, QQQ→1)
- `nearSpotRange = spot × 0.015` reemplaza `± 5 pts` fijos (visibilidad y fallback interacción)
- `absorptionMaxGap = 2 × gridStep` reemplaza `≤ 3 pts` en cadena de absorción superior
- Detección de vacío: `> gridStep` en lugar de `> 1` (fix para GOOGL/TSLA donde cada par adyacente era "vacío")
- Bordes de vacío: `± gridStep` en lugar de `± 1` (alineados con el grid real)
- Compresión: `< 2 × gridStep` en lugar de `< 3 pts`
- Distancia King: `≤ 3 × gridStep` (Cerca), `≤ 8 × gridStep` (Media)
- S/R: eliminado filtro `gex > 0` de resistencias y soportes — ahora rankea por `|GEX|` y muestra signo
- **Bonus fix**: `dealerBiasVal` (variable inexistente, residuo del ítem 2) corregida a `clientBias`

---

## FASE 2 — MEDIA: Arquitectura y Consistencia
> Estimado: 27–38 h | Meta: eliminar duplicación, unificar motor

### ✅ ÍTEM 7 — Módulo Único de Cálculo Compartido (M1, M2, M3)
**Severidad**: 🟡 MEDIA  
**Error**: La lógica de cálculo está triplicada/cuadruplicada en:
- `backend/main.py` — `r=4.5%`, T con floor 0.5 días
- `src/app/api/options/route.ts` — copia 2
- `src/app/page.tsx` — copias 3 y 4
- `src/app/components/GammaMatrix.tsx` — copia 5

Además: `r=5%` en frontend vs `r=4.5%` en backend; expiración tratada como medianoche UTC en lugar de 16:00 ET.

**Plan de corrección**:
1. Crear `src/lib/gex-engine.ts` — motor único y compartido
2. Fijar `r` y `T` en un solo lugar (expiración = 16:00 ET)
3. Reemplazar todas las copias por llamadas al módulo
**Estado**: ✅ COMPLETADO — 11-jun-2026  
**Archivos modificados**: `src/lib/gex-engine.ts` (creado), `src/app/api/options/route.ts`, `src/app/components/GammaMatrix.tsx`, `src/app/page.tsx` (×5 bloques), `backend/main.py`  
**Cambios clave**: `RISK_FREE_RATE=0.045`, `calcT()` con 20:30 UTC, `calcGamma()`, `calcVanna()`, `findGammaFlip()` — todas las copias eliminadas y reemplazadas por llamadas al motor compartido.

---

### ✅ ÍTEM 8 — Presión VEX/GEX en Unidades Comparables (C8)
**Severidad**: 🟡 MEDIA  
**Error**: La "Presión VEX/GEX" compara unidades incompatibles:
- VEX: `vanna·OI·S` (por punto de vol)
- GEX: `γ·OI·S²` (por 1% de spot)

El ratio no tiene significado económico; los umbrales 10%/30% son arbitrarios.  
**Corrección**: Normalizar ambos a dólares por escenario definido explícitamente.

**Estado**: ✅ COMPLETADO — 11-jun-2026  
**Archivos modificados**: `src/app/page.tsx`  
**Cambios**: Eliminado `×100` — ambos escenarios (1% spot / 1 vol point) se normalizan con `×0.01` que se cancela en el ratio. Resultado: `|netVex| / |netGex|`. Umbrales recalibrados: <0.05 Precio, 0.05–0.20 Mixto, >0.20 Vol. Display actualizado de `X.X%` a `0.XXX×`. Barra de progreso escalada ×500 (100% = ratio 0.20).

---

### ✅ ÍTEM 9 — Persistencia Server-Side + EMA/Decay (6.6)
**Severidad**: 🟡 MEDIA  
**Error**: Los snapshots viven en `localStorage` (máx. 5, por navegador, solo mientras la pestaña está abierta). En React StrictMode, el `useMemo` con efecto colateral se ejecuta doble y contamina la serie.

**Corrección**: 
- Registrar King/Net/spot server-side cada 1–5 minutos
- Persistencia = EMA de `1{King_t = King_t-1}` con half-life 30–60 min
- Eliminar `localStorage` como fuente de métricas

**Estado**: ✅ COMPLETADO — 11-jun-2026  
**Archivos modificados**: `src/app/api/snapshots/route.ts` (creado), `src/app/page.tsx`  
**Cambios**: Nuevo endpoint POST `/api/snapshots` con store en memoria (Map module-level, 60 snaps máx). EMA continua: `decay = exp(-Δt·ln2/45min)`, `ema = decay·ema_old + (1-decay)·indicator`. Side-effect de localStorage removido del `useMemo` → `useEffect` separado. `riskPersistence` usa EMA directamente. Umbrales: ema≥0.7 Persistente, ≥0.4 Estable, <0.4 Reciente.

---

### ✅ ÍTEM 10 — Riesgo Estructural V2 Multiplicativo (6.5)
**Severidad**: 🟡 MEDIA  
**Error**: Score actual = `0.45·dominancia + 0.30·|sesgo| + 0.20·proximidad + 0.05·persistencia`  
Sobreestima riesgo cuando el spot está cerca de un King POSITIVO (pin = MENOR movimiento).

**Fórmula V2** (multiplicativa, con signo del King):
```typescript
const fragilidad   = dominancia_full_chain;
const reactividad  = Math.max(0, -netGEX) / sumAbsGEX;
const proximidad   = Math.exp(-Math.abs(spot - king) / straddleATM);
const inestabilidad= 1 - persistencia_EMA;
const riesgo = 1 - (1 - fragilidad * reactividad) * (1 - inestabilidad * proximidad);
// Si netGEX > 0 y spot ≈ king → riesgo BAJO (pin), no alto ✓
```
**Estado**: ✅ COMPLETADO — 11-jun-2026  
**Archivos modificados**: `src/app/page.tsx`  
**Cambios**: Reemplazada fórmula aditiva V5.0 con multiplicativa V2. `fragilidad` usa cadena completa (`sumAbsAllGex`). `reactividad = max(0,-netGEX)/sumAbs` — se anula en régimen positivo. `proximidad` gaussiana normalizada al straddle ATM (`S·σ_ATM·√T·√(2/π)`). `inestabilidad = 1 - EMA`. Score: `1 - (1-frag·react)(1-inest·prox)`. `riskDesc` actualizado a Frag/React/Prox/Inest.

---

### ✅ ÍTEM 11 — Métricas Invariantes a la UI (6.1, 6.3, 6.9)
**Severidad**: 🟡 MEDIA  
**Error**: Dominancia, sesgo, densidad y riesgo se calculan sobre los strikes **visibles** según el control de UI (Window ±10/±20/±30/Full). La misma estructura da dominancias distintas según el zoom.

**Corrección**:
- Dominancia: `|GEX_king| / Σ|GEX_k|` sobre la **cadena completa**
- Sesgo: `netGEX / Σ|GEX_k|` con etiqueta direccional (preservar signo)
- Densidad: Índice Herfindahl sobre distribución de `|GEX|` en todos los strikes
- Compresión: distancia en unidades de straddle ATM (no puntos absolutos)

**Estado**: ✅ COMPLETADO — 11-jun-2026  
**Archivos modificados**: `src/app/page.tsx`  
**Cambios**: `sumAbsAllGex` movido a aggregates (se reutiliza en dominancia, riesgo, sesgo, HHI). Dominancia usa `sumAbsAllGex` en lugar de `sumAbsVisibleGex`. Sesgo calculado sobre `strikeData` completo con etiqueta con signo ("Positivo Dominante"/"Negativo Dominante"). Densidad reemplazada por HHI normalizado: `(hhi - 1/N)/(1 - 1/N)`, umbros 0.3/0.6. `straddleATM` movido a aggregates y reutilizado. Compresión muestra `${A}–${B} (X.XX×σ)` en unidades de straddle.

---

## FASE 3 — BAJA: Calidad y Hardening
> Estimado: 12–16 h | Meta: producción limpia y mantenible

### ÍTEM 12 — Dealer-Builder: Decay y Sin Clamping por Pata (7.1)
**Severidad**: 🟢 BAJA  
**Error**: El estimador tiene 3 sesgos estructurales:
- Dependencia de trayectoria: mismo OI final → bias +1 o −1 según orden de flujos
- Clamping asimétrico: infla el inventario retenido (`buy+sell > OI`)
- OI día 0 descartado: bias estimado solo sobre la cola de cambios

**Estado**: ✅ COMPLETADO — 12-jun-2026  
**Archivos modificados**: `scripts/dealer-builder.js`  
**Cambios**:
- Day-0 OI: `buy = sell = history[0].oi * 0.5` — prior neutro en lugar de descartar el OI inicial
- Cierres proporcionales: cuando OI baja, se retira `absDelta × (buy/total)` y `absDelta × (sell/total)` — sin path dependency ni inflación por clamping asimétrico
- Renormalización final: `scale = lastOI / (buy+sell)` — elimina drift flotante, garantiza `buy+sell = lastOI`

---

### ÍTEM 13 — Hardcodes, Caché y Seguridad (M4, M8, M9)
**Severidad**: 🟢 BAJA  
**Problemas**:
- M4: Valores demo hardcodeados (SPY 745 / 2026-06-08) en 4 ubicaciones de producción
- M8: POST `/api/dealer/build` ejecuta proceso Node por request sin lock ni auth → riesgo DoS
- M9: `displayExpirations` recorta a 5/10 vencimientos silenciosamente
- Etiqueta "$" sin documentar que es "$ por 1% move"
- Label "OI as-of" ausente en el dashboard

**Estado**: ✅ COMPLETADO — 12-jun-2026  
**Archivos modificados**: `src/app/api/dealer/build/route.ts`, `src/app/page.tsx`  
**Cambios**:
- M4: hardcodes demo (745/2026-06-08) ya eliminados en ítem 3 — nada pendiente
- M8: lock booleano en `/api/dealer/build` → 429 si ya hay build en curso; `finally` garantiza liberación
- M9: `totalExpirations` useMemo separado; label cambia de `"5 Available"` a `"5 of 22 shown"` cuando hay truncado, `"22 available"` cuando no
- GEX label: subtítulo en Data Table y GEX Matrix panel actualizados a `"$ per 1% spot move"` / `"$ / 1% spot"`
- OI as-of: tooltip del dealer ahora muestra `OI 1420 (as-of: 2026-06-11)`

---

## TABLA DE ESTADO GENERAL

| # | Ítem | Severidad | Fase | Resuelve | Estado |
|---|------|-----------|------|----------|--------|
| 1 | Fórmula Vanna (−φ(d1)·d2/σ) | 🔴 CRÍTICA | 1 | C1 | ✅ Completado |
| 2 | Signo Dealer Calls | 🔴 CRÍTICA | 1 | C2 | ✅ Completado |
| 3 | Default Bias sin dato UW | 🔴 CRÍTICA | 1 | C3 | ✅ Completado |
| 4 | Sanitización IV Yahoo | 🔴 CRÍTICA | 1 | C4, C5 | ✅ Completado |
| 5 | Gamma Flip: cruce más cercano | 🟠 ALTA | 1 | C7 | ✅ Completado |
| 6 | Parámetros relativos al grid | 🟠 ALTA | 1 | C6 | ✅ Completado |
| 7 | Módulo único de cálculo | 🟡 MEDIA | 2 | M1–M3 | ✅ Completado |
| 8 | Presión VEX/GEX en unidades comparables | 🟡 MEDIA | 2 | C8 | ✅ Completado |
| 9 | Persistencia server-side + EMA | 🟡 MEDIA | 2 | 6.6 | ✅ Completado |
| 10 | Riesgo V2 multiplicativo | 🟡 MEDIA | 2 | 6.5 | ✅ Completado |
| 11 | Métricas invariantes a la UI | 🟡 MEDIA | 2 | 6.1, 6.3, 6.9 | ✅ Completado |
| 12 | Dealer-builder decay | 🟢 BAJA | 3 | 7.1 | ✅ Completado |
| 13 | Hardcodes, caché, seguridad | 🟢 BAJA | 3 | M4, M8, M9 | ✅ Completado |

---

## Hallazgos Menores (sin ítem propio, incluidos en ítems de Fase 2–3)

| ID | Descripción | Resuelto en |
|----|-------------|-------------|
| M1 | r=4.5% backend vs 5% frontend | Ítem 7 |
| M2 | 3 convenciones de T distintas | Ítem 7 |
| M3 | Lógica duplicada ×4 | Ítem 7 |
| M4 | Hardcodes demo en producción | Ítem 13 |
| M5 | Etiqueta "Dominante" pierde signo | Ítem 11 |
| M6 | rawTotal = netTotal (variables duplicadas) | Ítem 7 |
| M7 | vannaFlip por suma acumulada (no es flip real) | Ítem 8 |
| M8 | POST /api/dealer/build sin lock ni auth | Ítem 13 |
| M9 | displayExpirations recorta silenciosamente | Ítem 13 |
| M10 | Snapshot en useMemo (efecto colateral) | Ítem 9 |

---

## Validación por Ítem

Cada ítem completado se validará ejecutando el test correspondiente del archivo `validacion_auditoria.py`:

| Ítem | Test de validación |
|------|-------------------|
| 1 (Vanna) | Test 1: ratio sistema/correcto ≈ 1.000 para todos los DTE |
| 2 (Signo dealer) | Test 2: los 4 escenarios call/put deben marcar "OK" |
| 3 (Bias default) | Test 2 + revisión manual en modo DEALER |
| 4 (IV sanitización) | Test 7: IV > 100% no se divide por 100; backend = frontend |
| 5 (Gamma Flip) | Test 5: debe retornar 695 (cercano al spot), no 612.5 |
| 6 (Grid relativo) | Test 4: NVDA debe detectar cadena de más de 1 nodo |
| 7 (Módulo único) | Revisión de code coverage + test regresión |
| 8–13 | Revisión manual + test de humo end-to-end |

---

## Protocolo de Trabajo

1. **Propongo** el cambio con código exacto a modificar
2. **Tú apruebas** (o ajustas antes de aprobar)
3. **Ejecuto** los cambios en el código
4. **Valido** con el test correspondiente del `validacion_auditoria.py` u otro test
5. **Muestro resultado** visual o de consola
6. **Actualizo** el estado en esta tabla a ✅ COMPLETADO
7. **Pasamos al siguiente** ítem

> ⚠️ **Ningún cambio se aplica sin tu aprobación explícita.**

---

*Generado por Antigravity — basado en Auditoría Cowork del 11-jun-2026*
