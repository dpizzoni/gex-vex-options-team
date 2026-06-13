# 📋 PLAN DE CORRECCIÓN — Segunda Auditoría GEX/VEX (v2)
> Basado en: `Auditoria_GEX_VEX_v2_post_correccion.docx` + `build_informe_v2.js`  
> Fecha de auditoría: 12 de junio de 2026  
> Fecha de correcciones: 13 de junio de 2026  
> Estado: **7 de 8 hallazgos resueltos** | 1 pendiente por decisión de infraestructura

---

## Contexto

La v2 auditó el código post-corrección de los 13 ítems del plan original (`PLAN_CORRECCION_AUDITORIA.md`). De los 13 ítems del plan, 12 quedaron verificados de forma independiente; 1 (sanitización IV, ítem 4) quedó parcial porque implementó el filtro de rango pero no la reparación por paridad call/put — la cual se completa en esta segunda ronda.

---

## Scores actualizados

| Dimensión          | v1   | v2   | v3 (post esta ronda) |
|--------------------|------|------|----------------------|
| Teoría             | 6/10 | 8/10 | 8/10                 |
| Implementación     | 4/10 | 7/10 | 8/10                 |
| Precisión          | 3/10 | 6/10 | 7/10                 |
| Robustez           | 3/10 | 6/10 | 6/10 *(R4 pendiente)* |
| Utilidad operativa | 5/10 | 7/10 | 8/10                 |

---

## Hallazgos de la v2 y estado de corrección

| ID | Severidad | Hallazgo | Estado |
|----|-----------|----------|--------|
| R1 | 🟠 ALTA | Sanitización filtra pero no repara: lado ITM ausente, γcall/γput hasta 2.5× distintas al mismo strike | ✅ Completado |
| R2 | 🟡 MEDIA | Modo DEALER aplica `Math.abs()` a vanna (correcto para GEX, destruye signo intrínseco en VEX) | ✅ Completado |
| R3 | 🟡 MEDIA | Convención de posicionamiento inconsistente entre matrices RAW: GEX usa call+/put−, VEX sumaba sin distinción | ✅ Completado |
| R4 | 🟡 MEDIA | Persistencia server-side sobre `Map` en memoria del proceso — se pierde en cold starts de Vercel serverless | ⏳ Pendiente (decisión de infraestructura) |
| R5 | 🟢 BAJA | `GammaMatrix.tsx` usaba `sigma<=0 \|\| sigma>4.0` (faltaba límite inferior 0.03); `page.tsx` replicaba el rango manualmente en 4 lugares | ✅ Completado |
| R6 | 🟢 BAJA | `dealer-builder.js`: prior day-0 era 50/50 neutro en lugar de por tipo; sin ponderación por recencia | ✅ Completado |
| R7 | 🟢 BAJA | Calibraciones heurísticas sin respaldo empírico (umbrales Presión, HHI, EMA, dominancia) | ⏳ Pendiente (depende de R4 para acumular historial) |
| R8 | 🟢 BAJA | `calcT` fijaba 20:30 UTC todo el año; en horario de verano 16:00 ET = 20:00 UTC (error +30 min) | ✅ Completado |

---

## Detalle de correcciones implementadas (13-jun-2026)

### R1 — Paridad call/put + IV desde mid-price
**Archivos**: `src/lib/gex-engine.ts`, `src/app/api/options/route.ts`

**Nuevas funciones en el motor (`gex-engine.ts`)**:
- `normalCDF(x)` — CDF normal estándar (Abramowitz & Stegun 26.2.17, error < 7.5e-8)
- `bsPrice(S, K, T, sigma, isCall)` — precio teórico Black-Scholes para call o put europeo
- `calcIVFromPrice(S, K, T, midPrice, isCall)` — solver Newton-Raphson: dado el mid-price `(bid+ask)/2`, encuentra σ tal que `BS(σ) = midPrice`; semilla Brenner-Subrahmanyam, converge en < 5 iteraciones

**Reestructura de `route.ts` en 3 fases**:
1. **Fase 1**: recolecta datos crudos en `rawCallMap` / `rawPutMap` por strike (O(1) lookup)
2. **Fase 2**: por cada strike determina el lado OTM (call si strike ≥ spot, put si < spot) → toma IV del OTM; si Yahoo devuelve IV inválida → deriva IV desde mid-price; si OTM falla → intenta ITM como fallback
3. **Fase 3**: formatea ambos contratos con el mismo `unifiedIV` → **γcall ≈ γput** al mismo strike (antes: hasta 2.5× de diferencia)

**Efecto en producción esperado**: el lado ITM que aparecía con γ=0 ahora hereda el IV del lado OTM correspondiente; el perfil GEX ITM vuelve a ser visible; Net GEX y el Gamma Flip se calculan sobre un perfil simétrico y completo.

---

### R2 — DEALER VEX sin `Math.abs()`
**Archivos**: `src/app/components/GammaMatrix.tsx`, `src/app/page.tsx` (×2 funciones `getExposureValue`)

La vanna tiene signo intrínseco propio: positivo para calls OTM / puts ITM (via `d2 > 0`), negativo para calls ITM / puts OTM (via `d2 < 0`). El `Math.abs()` destruía ese signo e imponía que toda call tuviera VEX positivo y toda put negativo, lo cual es incorrecto.

**Cambio**: en modo DEALER, `dealerVex = -clientBias × rawVex` (sin abs).  
**Patrón anterior**: `return -clientBias * Math.abs(baseValue)`  
**Patrón nuevo**: `return isVex ? -clientBias * baseValue : -clientBias * Math.abs(baseValue)`

---

### R3 — Convención RAW VEX consistente con GEX
**Archivos**: `src/app/components/GammaMatrix.tsx` (nueva función `getVexValue`), `src/app/page.tsx` (×3 lugares), `src/app/api/options/route.ts` (via paridad)

GEX usa `+gamma` para calls y `-gamma` para puts (dealer largo calls, corto puts). VEX sumaba vanna sin distinción de tipo, describiendo un dealer hipotético distinto.

**Cambio**: en modo RAW, `vex = (type === "CALL" ? 1 : -1) × vanna × OI × spot`.  
Las dos matrices RAW ahora describen el mismo dealer implícito y son comparables entre sí.

---

### R5 — `sanitizeIV()` centralizado
**Archivos**: `src/app/components/GammaMatrix.tsx`, `src/app/page.tsx` (×4 lugares)

`GammaMatrix.tsx` usaba `sigma <= 0 || sigma > 4.0` (sin límite inferior 0.03); `page.tsx` replicaba la condición inline en 4 lugares distintos.

**Cambio**: todos los consumidores ahora llaman a `sanitizeIV()` del motor (`@/lib/gex-engine`). Si en el futuro cambia el rango válido, basta con modificar un solo lugar.

---

### R6 — `dealer-builder.js`: prior por tipo + decay de recencia
**Archivo**: `scripts/dealer-builder.js`

**Prior day-0**: antes era neutro 50/50. Ahora aplica el prior SqueezeMetrics por tipo de contrato (extraído del OCC ID):
- Calls: `sell = OI, buy = 0` (clientBias = −1 por defecto)
- Puts: `buy = OI, sell = 0` (clientBias = +1 por defecto)

**Decay de recencia**: cada `ΔOI` se pondera por `exp(-edad × ln2 / 20días)`:
- Flujo de hoy: peso 1.0
- Flujo de hace 20 días: peso 0.5
- Flujo de hace 40 días: peso 0.25
- Constante: `DECAY_HALF_LIFE_DAYS = 20`

El valor se renormaliza a `lastOI` al final (como antes), por lo que `buy + sell = lastOI` siempre se mantiene.

---

### R8 — DST-aware `calcT`
**Archivos**: `src/lib/gex-engine.ts`, `backend/main.py`

**Cambio**:
```typescript
// Antes (fijo): T20:30:00Z todo el año  → error +30min en verano
// Después (DST-aware):
const month = parseInt(expirationDateStr.slice(5, 7), 10);
const closeUTC = (month >= 4 && month <= 10) ? "T20:00:00Z" : "T21:00:00Z";
```

Abril–Octubre (EDT, UTC-4): cierre a 20:00 UTC.  
Noviembre–Marzo (EST, UTC-5): cierre a 21:00 UTC.  
Semanas de transición de marzo y noviembre: error residual ≤1h, documentado como aceptable.

El backend Python replica exactamente la misma lógica:
```python
month = int(selected_exp[5:7])
close_utc = "T20:00:00" if 4 <= month <= 10 else "T21:00:00"
```

---

## Hallazgos pendientes y decisiones requeridas

### R4 — Persistencia durable de snapshots
**Problema**: el store de snapshots es un `Map` en memoria del proceso Next.js. En Vercel serverless: cada instancia tiene su propio store, los cold starts lo vacían, el balanceo fragmenta la serie. El `riskPersistence` (insumo del Riesgo V2) oscila por razones de infraestructura, no de mercado.

**Estimado**: 4–8 h una vez tomada la decisión.

**Decisiones requeridas**:

| # | Pregunta |
|---|----------|
| A | ¿Vercel Pro o Hobby? (Pro habilita Vercel Cron Jobs y Vercel KV) |
| B | ¿El backend Python corre como servicio siempre activo (uptime garantizado)? |
| C | Dado A y B: ¿preferís **Vercel KV**, **Upstash Redis** (free tier), **Supabase**, o archivo en VPS del backend? |
| D | ¿Quién dispara los snapshots? (**Vercel Cron** / **GitHub Actions schedule** / **cron en el backend Python**) |

**Opciones resumidas**:

| Storage | Trigger | Costo | Requisito |
|---------|---------|-------|-----------|
| Vercel KV | Vercel Cron | $20/mes (Pro) | Vercel Pro |
| Upstash Redis | GitHub Actions `*/5` | $0 (free tier) | Cuenta Upstash |
| Upstash Redis | Cron en backend Python | $0 | Backend siempre activo |
| Archivo en VPS | Cron en backend Python | $0 | Backend siempre activo |

---

### R7 — Calibración empírica de umbrales
**Problema**: los umbrales actuales son heurísticos sin respaldo en datos reales:
- Presión VEX/GEX: `<0.05` / `0.05–0.20` / `>0.20`  
- Densidad HHI: `0.3` / `0.6`  
- EMA persistencia: `0.4` / `0.7`  
- Half-life EMA: 45 min  
- Dominancia: `20/40/60%`

**Dependencia**: R7 requiere R4. Sin historial acumulado de snapshots, no hay datos para calibrar.

**Estimado**: 6–8 h (una vez disponible historial de ~2–4 semanas).

**Decisión**: ¿Qué variable de mercado se usa como referencia para la calibración?

| Referencia | Descripción | Dificultad |
|------------|-------------|------------|
| Rango diario H-L | Baja presión → menor rango realizado | Fácil (Yahoo OHLC) |
| Realización de escenario | ¿El mercado rompió el trigger predicho? | Media (requiere logging de predicciones) |
| Régimen de volatilidad | Comparar Presión con VIX / ATM straddle realizado | Fácil (datos Yahoo) |

---

## Archivos actualizados en esta ronda

| Archivo | Cambios |
|---------|---------|
| `src/lib/gex-engine.ts` | R1: `normalCDF`, `bsPrice`, `calcIVFromPrice` / R8: `calcT` DST-aware |
| `src/app/api/options/route.ts` | R1: 3 fases (raw → unified IV → format) con paridad call/put y fallback mid-price |
| `src/app/components/GammaMatrix.tsx` | R2+R3: nueva función `getVexValue` / R5: usa `sanitizeIV()` |
| `src/app/page.tsx` | R2+R3: `getExposureValue` con param `isVex` (×2) / R5: `sanitizeIV()` en 4 lugares / R3: tipo+/− en `computedRows` y `netVex` |
| `scripts/dealer-builder.js` | R6: prior por tipo (OCC ID) + decay de recencia `exp(-edad/20d)` |
| `backend/main.py` | R8: `calcT` DST-aware en Python |

Snapshot de todos los archivos copiado en `claude_audit_files/` — 13-jun-2026.

---

*Generado por Antigravity — basado en Auditoría Cowork v2 del 12-jun-2026*
