# Technical Design Specification (TDS)
## Sistema de Análisis de Opciones GEX / VEX / Dealer / Gamma Regime

> **Audiencia**: desarrolladores que deban mantener, extender o reescribir el sistema desde cero.
> **Alcance**: descripción interna completa de procesos, algoritmos, fórmulas, modelo de datos y arquitectura.
> **Fuente**: análisis directo del código fuente (`src/`, `scripts/`, `backend/`), configuración (`package.json`, `vercel.json`, workflows de GitHub Actions), muestras de caché (`cache/`) y documentación de auditoría (`docs/`).
> **Fecha de redacción del documento**: 2026-07-09.

---

### Convención de confiabilidad usada en todo el documento

Cada afirmación técnica se etiqueta implícita o explícitamente según su origen. Para evitar ambigüedad, se usan estos marcadores cuando corresponde:

| Marcador | Significado |
|----------|-------------|
| **[DATO REAL]** | Proviene de una fuente externa medida (Yahoo Finance, Unusual Whales). |
| **[CALCULADO]** | Resultado determinista de una fórmula matemática cerrada sobre datos reales. |
| **[INFERIDO]** | Estimación construida por un modelo/heurística que aproxima algo no observable directamente (p. ej. posicionamiento del dealer). |
| **[HEURÍSTICO]** | Umbral o etiqueta calibrada a criterio, sin respaldo estadístico formal (marcada como pendiente R7 en la auditoría interna). |
| **[MOCK]** | Dato sintético generado por el sistema (no real). |
| **⚠️ NO DEDUCIBLE** | Comportamiento que el código no permite determinar con certeza; requiere verificación empírica o consulta. |

---

## 1. Arquitectura general

### 1.1. Naturaleza del sistema

El sistema es una aplicación **Next.js 15 (App Router, React 19)** desplegada en **Vercel**, con:

- Un **frontend** SPA (dashboard) que renderiza matrices de exposición, paneles de análisis y gráficos de régimen.
- Un conjunto de **API Routes** server-side (Next.js) que sirven datos en vivo (Yahoo) y datos pre-computados (archivos JSON en `cache/`).
- Un **backend Python FastAPI** (`backend/main.py`) redundante para cálculo de GEX en entorno local.
- Una **capa de adquisición de datos batch** (scripts Node + Playwright) que hace scraping de Unusual Whales y snapshots de Yahoo, ejecutada por **GitHub Actions** en horarios fijos, que **commitea los JSON resultantes al propio repositorio** (`cache/`).

La persistencia principal de datos históricos **no es una base de datos**: son archivos JSON versionados en Git dentro de `cache/`. Vercel sirve esos archivos como sistema de archivos de solo lectura.

### 1.2. Módulos principales

```
┌────────────────────────────────────────────────────────────────────────┐
│                          CAPA DE PRESENTACIÓN                            │
│  src/app/page.tsx  (dashboard raíz, 2680 líneas, orquestador)           │
│   ├── GammaMatrix.tsx        (matriz heatmap strike × expiración)        │
│   ├── GammaRegimePanel.tsx   (panel régimen de gamma)                    │
│   ├── GammaRegimeChart.tsx   (gráfico histórico + forward)               │
│   └── NotificationBell.tsx   (alertas de cambio de régimen)             │
└────────────────────────────────────────────────────────────────────────┘
                                   │  fetch()
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    CAPA DE API (Next.js Route Handlers)                  │
│  /api/options            → GEX en vivo desde Yahoo (route.ts)            │
│  /api/dealer             → lee cache/dealer/**  (loadDealer)             │
│  /api/dealer/build       → dispara dealer-builder.js (solo local)       │
│  /api/regime-history     → lee cache/regime-history-{T}.json            │
│  /api/regime-forward     → lee cache/gamma-forward-{T}.json             │
│  /api/regime-alerts      → lee cache/regime-alerts.json                 │
│  /api/snapshots          → persistencia in-memory (EMA King Node)       │
│  /api/gamma-capture-meta → estado del último workflow (GitHub API)      │
│  /api/cron/trigger-*     → dispara workflows GitHub por Vercel Cron     │
└────────────────────────────────────────────────────────────────────────┘
                                   │
             ┌─────────────────────┴──────────────────────┐
             ▼                                             ▼
┌──────────────────────────┐            ┌──────────────────────────────────┐
│   MOTORES DE CÁLCULO      │            │        CAPA DE DATOS               │
│  src/lib/gex-engine.ts    │            │  cache/dealer/{T}/{exp}/*.json    │
│  src/lib/dealer-engine.ts │            │  cache/uw/{T}/{exp}/*.json        │
│  src/lib/gamma-regime-    │            │  cache/regime-history-{T}.json    │
│      engine.ts            │            │  cache/gamma-forward-{T}.json     │
│  backend/main.py (FastAPI)│            │  cache/regime-alerts.json         │
└──────────────────────────┘            └──────────────────────────────────┘
                                                       ▲
                                                       │ commit (git-auto-commit)
┌──────────────────────────────────────────────────────────────────────────┐
│              CAPA DE ADQUISICIÓN BATCH (GitHub Actions + Playwright)       │
│  scripts/uw-fetch-gamma-data.js  → scrape UW /api/gex → regime-history     │
│  scripts/uw-window-fetch.js      → scrape UW option_chains (OI histórico)  │
│  scripts/dealer-builder.js       → OI histórico → dealer bias             │
│  scripts/check-regime-shifts.js  → detecta flips → regime-alerts.json      │
│  scripts/uw-session.js           → login compartido a UW                   │
│  backend/main.py / route.ts      → provee spot+strikes a los scrapers     │
└──────────────────────────────────────────────────────────────────────────┘
```

### 1.3. Flujo completo de datos (macro)

```
        ┌─────────────────────────────┐        ┌─────────────────────────────┐
        │   Yahoo Finance (yfinance /  │        │   Unusual Whales (scraping   │
        │   yahoo-finance2)            │        │   Playwright con login)      │
        │   • spot                     │        │   • OI histórico por contrato│
        │   • cadena de opciones       │        │   • color bid/ask (agresión) │
        │   • IV, OI, volumen, bid/ask │        │   • GEX agregado (endpoints) │
        └──────────────┬──────────────┘        └───────────────┬─────────────┘
                       │                                        │
      TIEMPO REAL      │                       BATCH (GitHub Actions, cron)
     (por request)     │                                        │
                       ▼                                        ▼
        ┌─────────────────────────────┐   ┌──────────────────────────────────────┐
        │ /api/options (route.ts)     │   │ ETAPA 1: uw-fetch-gamma-data.js        │
        │  • sanitiza IV              │   │  → regime-history-{T}.json             │
        │  • paridad call/put         │   │  → gamma-forward-{T}.json              │
        │  • γ = BS gamma             │   │ ETAPA 1b: check-regime-shifts.js       │
        │  • GEX = γ·OI·S²            │   │  → regime-alerts.json                  │
        │  • King Node, Gamma Flip    │   │ ETAPA 2: uw-window-fetch.js (OI hist)  │
        └──────────────┬──────────────┘   │  → cache/uw/**                         │
                       │                  │ ETAPA 2b: dealer-builder.js            │
                       │                  │  → cache/dealer/** (bias por contrato) │
                       │                  └───────────────────┬────────────────────┘
                       │                                       │
                       ▼                                       ▼
        ┌────────────────────────────────────────────────────────────────────┐
        │                        FRONTEND (page.tsx)                          │
        │  Combina:                                                           │
        │   • cadena en vivo (Yahoo) + dealer bias (cache) → Dealer Analysis  │
        │   • VEX calculado client-side (vanna·OI·S)                          │
        │   • regime-history + forward → Gamma Regime Engine                   │
        │  Renderiza: Matriz GEX/VEX, panel Dealer, panel Régimen, alertas    │
        └────────────────────────────────────────────────────────────────────┘
```

### 1.4. Stack tecnológico

| Capa | Tecnología | Versión (package.json / código) |
|------|-----------|----------------------------------|
| Framework web | Next.js (App Router) | ^15.1.0 |
| UI | React / React-DOM | 19.2.4 |
| Iconos | lucide-react | ^1.17.0 |
| Datos de mercado (TS) | yahoo-finance2 | ^3.15.2 |
| Backend alternativo | FastAPI + yfinance + pandas | Python 3.10 |
| Scraping | Playwright (chromium) | ^1.60.0 |
| Parsing HTML (offline) | jsdom | ^29.1.1 |
| Orquestación batch | GitHub Actions + Vercel Cron | — |
| Persistencia histórica | Archivos JSON en Git (`cache/`) | — |

---

## 2. Separación de procesos

El sistema es explícitamente **multiproceso**. Hay dos familias de procesos con responsabilidades disjuntas: el **Alimentador de datos** (adquisición) y el **Post-procesamiento** (cálculo e interpretación). El punto de contacto entre ambos es el directorio `cache/`.

### 2.1. Alimentador de datos (adquisición)

Procesos: `scripts/uw-fetch-gamma-data.js`, `scripts/uw-window-fetch.js`, `scripts/uw-fetch.js`, `scripts/uw-parse.js`, `scripts/uw-expand.js`, `scripts/uw-session.js`. Orquestados por `.github/workflows/daily-update.yml` y `gamma-intraday.yml`.

**Qué hace:**

- Se autentica en Unusual Whales con Playwright (login por usuario/contraseña vía secretos `UW_EMAIL`/`UW_PASSWORD`, sesión persistida en `auth_state.json` — gitignored).
- Descarga dos tipos de dato **[DATO REAL]** de UW:
  1. **GEX agregado por ticker** (endpoints internos de UW `/api/gex/{T}?timespan=1y`, `/api/gex/{T}/expiry`, `/api/gex/{T}/strike`), interceptando las respuestas JSON de la SPA de UW.
  2. **Historial de Open Interest por contrato individual** (página `flow/option_chains?chain={contractId}`), extrayendo la tabla "Historical Volume / OI" del DOM.
- Consulta a Yahoo (vía la propia `/api/options` local levantada en el runner) para obtener el listado de strikes y el spot, y así saber **qué contratos** scrapear.
- Normaliza fechas (formato UW `DD/MM` → ISO `YYYY-MM-DD`, con inferencia de año retrocediendo cuando el mes "sube") y la señal de color bid/ask (comparando anchos de barras `--danger`/`--success` en el HTML).
- Escribe archivos JSON en `cache/uw/**`, `cache/regime-history-{T}.json`, `cache/gamma-forward-{T}.json`.

**Persistencia incremental de `regime-history-{T}.json` (histórico propio > 1 año, `scripts/uw-fetch-gamma-data.js`):**

UW siempre devuelve su ventana completa de `timespan=1y` en cada carga de la página — no es un parámetro que este proyecto controle, es lo que la SPA de UW pide sola al renderizar el tab de Gamma Exposure. El sistema no puede pedirle a UW menos ni más de eso. Para construir un historial propio superior al año que UW retiene, `regime-history-{T}.json` dejó de sobrescribirse entero en cada corrida (comportamiento previo con `DISPLAY_DAYS=30`) y pasó a un modelo de **archivo persistente + merge incremental por upsert de fecha**:

- `MERGE_WINDOW_DAYS = 30`: en cada corrida normal (3x/día), solo se procesan y mergean las últimas 30 filas del payload de UW contra el archivo ya persistido, reemplazando por `date` (no se appendea a ciegas).
- Esto es intencional, no una limitación: sirve como ventana de auto-reparación. Si un cron falla un día (feriado mal calculado, caída de UW, error de red), la próxima corrida exitosa reincorpora ese día automáticamente siempre que el hueco sea ≤ 30 ruedas. También permite que las 3 corridas diarias sobre el mismo día hábil se pisen entre sí (upsert) en lugar de duplicar filas, y que las recalculaciones retroactivas de UW sobre días recientes (motivo documentado de por qué corre 3x/día, ver más abajo) se sigan propagando al archivo propio.
- Días fuera de esa ventana de 30 quedan **congelados para siempre**: no se vuelven a tocar ni a re-descargar (UW ya no los expone de todos modos más allá de 1y, y este proyecto asume que no hay revisiones fuera de esa ventana reciente).
- `ema3_net_gex` mantiene continuidad entre corridas: la EMA se siembra desde el último valor persistido inmediatamente anterior a la ventana de merge, no se resetea en cada corrida (si se resembrara desde cero en cada merge de 30 días, la serie mostraría un salto/discontinuidad artificial cada vez que corre el cron).
- **Carga inicial**: `npm run gamma:backfill` (o `node scripts/uw-fetch-gamma-data.js TICKER... --backfill`) siembra el archivo con el 1y completo (~252 ruedas) que UW devuelve hoy, antes de pasar al modo incremental. Es una operación de un solo uso por ticker (o para agregar un ticker nuevo, ver §14.1); correrla de nuevo sobre un archivo ya poblado es inofensiva (mergea el 1y completo vía upsert, sin duplicar).
- `gamma-forward-{T}.json` (paredes de gamma y expiraciones forward) **no** participa de este modelo: sigue siendo un snapshot del día que se sobrescribe entero en cada corrida, porque no es una serie histórica.
- Consumidores (`check-regime-shifts.js`, `src/lib/gamma-regime-engine.ts`, `src/app/api/regime-history/route.ts`, `GammaRegimeChart.tsx`) no requirieron cambios: todos operan sobre el array completo por índice/fecha sin asumir un tamaño fijo, y el componente de chart ya recortaba a los últimos 30 días para display mientras usaba el historial completo para sus cálculos rolling (`GammaRegimeChart.tsx:53-57`).

**Qué NO hace:**

- **No calcula** griegas (gamma, vanna), GEX propio, ni bias del dealer. (Excepción parcial: `uw-fetch-gamma-data.js` sí calcula `net_gex = call_gex + put_gex`, `ema3_net_gex`, `p_c_ratio` y walls, pero a partir de agregados que UW ya calculó; no corre Black-Scholes.)
- No interpreta señales ni genera texto de trading (eso es post-proceso; excepción: `check-regime-shifts.js` sí clasifica flips, ver §2.2).
- No sirve datos al frontend directamente: solo escribe a `cache/`.

**Qué información descarga vs. conserva vs. descarta:**

| Fuente | Descarga | Conserva | Descarta |
|--------|----------|----------|----------|
| UW `flow/option_chains` | Tabla completa Volume/OI histórica por contrato | `date`, `oi`, `bidAsk`, `redWidth`, `greenWidth`, `color` | Precio, volumen exacto, griegas de UW, resto del DOM |
| UW `/api/gex/*` | Serie 1y de call/put GEX y vanna, tabla por expiración, tabla por strike | Últimos 30 días (`DISPLAY_DAYS`), expiraciones con `0 < dte ≤ 40` (`MAX_DTE`) | Días > 30, strikes salvo para put/call walls |
| Yahoo (vía `/api/options`) | Spot + strikes por expiración | Solo se usa para construir la cola de contratos a scrapear | La cadena completa no se guarda desde el scraper |

**Cómo normaliza datos:** ver §5.2 (color bid/ask) y §5.3 (inferencia de año).

**Cómo maneja errores:**

- Reintentos de login con recuperación de sesión: si detecta logout a mitad de cola (`uw-window-fetch.js`), reintenta el contrato actual (`i--`).
- Errores por contrato se acumulan en `errors.json` sin abortar la corrida.
- Screenshots de diagnóstico a `debug/` en fallo (subidos como artifact de GitHub Actions).
- Timeouts de navegación de 15–30 s; `waitForFunction` sobre presencia de la tabla objetivo.
- Rate-limit: pausa de 3 s cada 20 contratos; delay de 300 ms entre contratos.

**Frecuencia:**

- **OI + dealer** (pesado, ~1 h): una vez por día hábil (cron `31 10 * * 1-5` UTC ≈ 06:31 ET, 6 min después del cierre de datos de UW a las 6:30 AM ET), vía `daily-update.yml`.
- **Gamma Regime** (liviano, ~5 min, 127 tickers): tres veces por día hábil — madrugada (dentro de `daily-update.yml`) + `0 15 * * 1-5` y `0 20 * * 1-5` UTC (`gamma-intraday.yml`). Motivo documentado: UW recalcula su GEX agregado intradía.
- **Nota explícita SPY/QQQ**: están incluidos en la lista de 127 tickers del script `uw:daily:gamma` (`package.json`, primeros dos símbolos) y por lo tanto pasan por el mismo pipeline de régimen y alertas que el resto — **no hay ningún caso especial que los excluya** de `check-regime-shifts.js` (que deriva su lista de tickers de los archivos `regime-history-*.json` presentes en `cache/`, y ambos existen). Verificado en `cache/regime-alerts.json`: ya existen alertas reales `LONG_GAMMA_ENTRY`/`SHORT_GAMMA_ENTRY`/`DOUBLE_GEX` para SPY y QQQ, generadas con la misma lógica que para cualquier otro ticker. La única diferencia de tratamiento para SPY/QQQ en todo el sistema es de **parámetros**, no de exclusión: `gridStep=1.0` fijo en `gamma-regime-engine.ts` (§6.13) y `expCount=5` expiraciones en la captura de OI (`daily-snapshot.js`, `uw-window-fetch.js`, `clean-cache.js`) — ambos ajustes existen porque SPY/QQQ cotizan opciones semanales de alta liquidez y requieren una ventana de expiraciones más corta, no porque estén excluidos de nada.

**APIs que consume:** Unusual Whales (scraping, no API pública), Yahoo Finance (indirecto vía `/api/options`), GitHub Actions API (para meta).

**Formato de salida:** ver §4 (modelo de datos). Todo es JSON en `cache/`.

### 2.2. Post-procesamiento (cálculo e interpretación)

Procesos: motores en `src/lib/*`, API routes de lectura, `scripts/dealer-builder.js`, `scripts/check-regime-shifts.js`, y toda la lógica de `page.tsx` / `GammaMatrix.tsx`.

**Qué cálculos realiza (matemáticos puros [CALCULADO]):**

- Black-Scholes gamma (`calcGamma`) y vanna (`calcVanna`).
- IV por inversión Newton-Raphson (`calcIVFromPrice`), precio BS (`bsPrice`), CDF normal (`normalCDF`).
- GEX = γ·OI·S², VEX = vanna·OI·S.
- King Node (máx |GEX|), Gamma Flip (raíz de netGEX(S)).
- EMA3 de net GEX, percentiles, HHI, medias móviles 20d/30d.

**Qué cálculos representan inferencias [INFERIDO]/[HEURÍSTICO]:**

- **Dealer bias** (`dealer-builder.js`): reconstruye posicionamiento cliente/dealer a partir de deltas de OI y color de agresión. Es un modelo, no un dato medido.
- **Régimen de gamma, cuadrantes, fuerza de shift, estabilidad, escenarios, absorción, riesgo, densidad**: clasificaciones con umbrales heurísticos (marcados R7-pendiente en auditoría).
- **Alertas de régimen** (`check-regime-shifts.js`): clasifica LONG/SHORT/DOUBLE_GEX a partir del signo de `net_gex`.

**Qué información recibe:** cadena Yahoo en vivo (`/api/options`), dealer cache (`/api/dealer`), regime-history/forward (archivos), persistencia in-memory (`/api/snapshots`).

**Qué información genera:** objetos de análisis en memoria del cliente (`analysisSnapshot`, `regimeData`, `matrixData`) y, en batch, `cache/dealer/**` y `cache/regime-alerts.json`.

**Frontera exacta entre etapas:** la línea divisoria es el archivo `cache/`. Todo lo que **escribe** `cache/` desde scraping crudo es Alimentador; todo lo que **transforma con matemática o heurística** es Post-proceso. `dealer-builder.js` es post-proceso aunque corra en el mismo workflow batch (transforma OI histórico crudo → bias inferido). `uw-fetch-gamma-data.js` es mayormente Alimentador aunque calcule `net_gex`/`ema3` (sumas triviales sobre agregados ya provistos por UW).

---

## 3. Pipeline completo (por etapa)

Formato por etapa: **Entrada → Proceso → Salida → Formato → Responsable → Dependencias.**

### Etapa P0 — Cadena de opciones en vivo (tiempo real)

- **Entrada**: `symbol`, `expiration?` (query params).
- **Proceso**: `route.ts` (o `backend/main.py`) consulta Yahoo, sanitiza IV, unifica IV por paridad call/put, calcula γ, GEX por contrato, King Node, Gamma Flip.
- **Salida**: JSON `OptionsResponse` (§4.1).
- **Formato**: JSON HTTP.
- **Responsable**: `src/app/api/options/route.ts` (producción/Vercel); `backend/main.py` (local, puerto 8000).
- **Dependencias**: `src/lib/gex-engine.ts`, red hacia Yahoo.

### Etapa 1 — Captura de GEX agregado (batch, régimen)

- **Entrada**: lista de 127 tickers (hardcoded en `package.json` script `uw:daily:gamma`).
- **Proceso**: `uw-fetch-gamma-data.js` navega la página Greek Exposure de UW por ticker, intercepta 3 endpoints JSON, construye historia de 30d con EMA3 y barras forward ≤40 DTE, computa put/call walls.
- **Salida**: `regime-history-{T}.json`, `gamma-forward-{T}.json`.
- **Formato**: JSON en `cache/` (arrays).
- **Responsable**: `scripts/uw-fetch-gamma-data.js` + `scripts/uw-session.js`.
- **Dependencias**: Playwright, sesión UW, secretos GH.

### Etapa 1b — Detección de cambios de régimen

- **Entrada**: `cache/regime-history-*.json`.
- **Proceso**: `check-regime-shifts.js` recorre cada ticker; detecta flip de signo de `net_gex` día a día (con umbral 10% de |media 30d|) y duplicaciones de GEX (ratio ≥ 1.8). Deduplica por `id`.
- **Salida**: `regime-alerts.json` (append incremental).
- **Formato**: JSON array de alertas.
- **Responsable**: `scripts/check-regime-shifts.js`.
- **Dependencias**: Etapa 1.

### Etapa 2 — Captura de OI histórico por contrato

- **Entrada**: `config/capture_plan.json` (`tickers`, `expirations`, `strikesEachSide`), spot+strikes de Yahoo.
- **Proceso**: `uw-window-fetch.js` construye una ventana de strikes alrededor del ATM (±`strikesEachSide`), genera contratos OCC (call+put), scrapea la tabla histórica OI de cada uno. Modo `--daily` es incremental (solo la fila más reciente).
- **Salida**: `cache/uw/{T}/{exp}/{contractId}.json`.
- **Formato**: JSON `{ contractId, history[] }` (§4.3).
- **Responsable**: `scripts/uw-window-fetch.js`.
- **Dependencias**: `/api/options` local (spot+strikes), Playwright, `cache-resolver.js`.

### Etapa 2b — Construcción del dealer bias

- **Entrada**: `cache/uw/**` (OI histórico + color por contrato).
- **Proceso**: `dealer-builder.js` recorre cada historial cronológicamente, descompone deltas de OI en buy/sell ponderados por color y recencia (decay 20d), renormaliza a `lastOI`, calcula `bias = (buy−sell)/lastOI`.
- **Salida**: `cache/dealer/{T}/{exp}/{contractId}.json`.
- **Formato**: JSON `{ contractId, buy, sell, bias, lastOI, lastDate }` (§4.4).
- **Responsable**: `scripts/dealer-builder.js` + `scripts/cache-resolver.js`.
- **Dependencias**: Etapa 2.

### Etapa 3 — Consumo en frontend

- **Entrada**: `/api/options` (vivo), `/api/dealer`, `/api/regime-history`, `/api/regime-forward`, `/api/regime-alerts`, `/api/snapshots`.
- **Proceso**: `page.tsx` combina cadena viva + dealer bias → Dealer Analysis; calcula VEX client-side; corre `computeGammaRegime`.
- **Salida**: DOM (dashboard interactivo).
- **Responsable**: `page.tsx`, `GammaMatrix.tsx`, `GammaRegimePanel/Chart.tsx`, `NotificationBell.tsx`.
- **Dependencias**: todas las etapas anteriores + `gex-engine.ts` + `gamma-regime-engine.ts`.

### Orquestación temporal (crons)

```
Vercel Cron (vercel.json)          GitHub Actions
─────────────────────────          ──────────────────────────────────────
31 10 * * 1-5  → trigger-daily ──►  daily-update.yml
                                     ├─ Etapa 1 (gamma) + 1b + commit
                                     └─ Etapa 2 (OI) + 2b + clean + commit
 0 15 * * 1-5  → trigger-gamma ──►  gamma-intraday.yml (solo Etapa 1 + 1b)
 0 20 * * 1-5  → trigger-gamma ──►  gamma-intraday.yml (solo Etapa 1 + 1b)
```
`daily-update.yml` también tiene `schedule` nativo de respaldo por si el cron de Vercel falla. La captura escribe con `git-auto-commit-action` y `[skip ci]`.

---

## 4. Modelo de datos

### 4.1. `OptionsResponse` (salida de `/api/options`)

```ts
interface OptionContract {
  strike: number;              // Precio de ejercicio (USD)
  impliedVolatility: number;   // IV en decimal. En route.ts = IV unificada usada en el cálculo (0.03–4.0). En backend/main.py = iv_raw de Yahoo.
  openInterest: number;        // OI (contratos). Entero ≥ 0.
  volume: number;              // Volumen del día (contratos).
  bid: number; ask: number;    // USD.
  gamma: number;               // Γ Black-Scholes (por unidad de S). 0 si IV inválida.
  gex: number;                 // γ·OI·S²  (call: +, put: −). Ver §6.3 para unidades.
  vanna: number;               // Siempre 0.0 a nivel API (VEX se calcula en cliente).
  vex: number;                 // Siempre 0 a nivel API.
}
interface OptionsResponse {
  spot: number;                // Precio spot del subyacente (USD).
  symbol: string;
  expirations: string[];       // Fechas ISO YYYY-MM-DD, ordenadas.
  selectedExpiration: string;
  calls: OptionContract[];
  puts: OptionContract[];
  kingNode: number | null;     // Strike con máx |GEX agregado|.
  gammaFlip: number | null;    // Spot teórico de netGEX = 0 más cercano al spot.
  vannaFlip: number | null;    // Siempre null (no implementado).
  totalCallGex: number;        // Σ gex de calls.
  totalPutGex: number;         // Σ gex de puts (negativos).
  netGex: number;              // totalCallGex + totalPutGex.
  totalCallVex, totalPutVex, netVex: number;  // Siempre 0 a nivel API.
  dealerBias: { overall, gexRegime, vexRegime: string }; // Siempre "N/A" a nivel API.
}
```

**Restricciones/validaciones**: `impliedVolatility` sanitizada a `[0.03, 4.0]` o descartada (γ=0). Contratos con `bid==0 && oi==0` se descartan (junk). `openInterest`/`volume` forzados a enteros; `NaN`/`Inf`→0 (`clean_value` en Python; `|| 0` en TS).

### 4.2. `RegimeHistoryEntry` (`cache/regime-history-{T}.json`)

```ts
interface RegimeHistoryEntry {
  date: string;          // ISO YYYY-MM-DD (día de trading).
  ticker: string;
  spot: number;          // Cierre del subyacente ese día [DATO REAL, close de UW].
  call_gex: number;      // GEX agregado de calls [DATO REAL, provisto por UW].
  put_gex: number;       // GEX agregado de puts (negativo).
  net_gex: number;       // call_gex + put_gex [CALCULADO trivial].
  call_vex: number;      // call_vanna de UW.
  put_vex: number;       // put_vanna de UW.
  net_vex: number;       // call_vex + put_vex.
  king_node: number | null;  // null cuando la fuente es uw-fetch-gamma-data (usa walls en su lugar).
  ema3_net_gex: number;  // EMA α=0.5 de net_gex (≈ EMA de 3 períodos) [CALCULADO].
}
```
Unidades de GEX/VEX: las que entrega UW (dólares nominales por 1% / por punto de vol). **Escala distinta** a la del motor Yahoo local — ver §6.13 (advertencia de no mezclar escalas).

### 4.3. Historial UW crudo (`cache/uw/{T}/{exp}/{contractId}.json`)

```ts
{
  contractId: string;    // OCC: {TICKER}{YYMMDD}{C|P}{strike*1000 a 8 dígitos}
  history: Array<{
    date: string;        // ISO.
    oi: number;          // Open Interest ese día [DATO REAL].
    bidAsk: number;      // Fracción de agresión hacia el color dominante (0–1) [DATO REAL].
    redWidth: number;    // Ancho % de barra roja (venta al bid).
    greenWidth: number;  // Ancho % de barra verde (compra al ask).
    color: 'green'|'red'|'unknown';  // Señal de agresión neta [INFERIDO por comparación de anchos].
  }>
}
```
Regla de `color`: si `|redWidth − greenWidth| < 15` → `unknown`; si no, gana el mayor. `bidAsk` por defecto 0.5 si no hay `%`.

### 4.4. Dealer snapshot (`cache/dealer/{T}/{exp}/{contractId}.json`)

```ts
{
  contractId: string;
  buy: number;    // Inventario "comprado" reconstruido (contratos, entero) [INFERIDO].
  sell: number;   // Inventario "vendido" reconstruido [INFERIDO].
  bias: number;   // (buy − sell) / lastOI  ∈ [−1, +1] [INFERIDO]. Posicionamiento del CLIENTE.
  lastOI: number; // OI del último día del historial.
  lastDate: string;
}
```
Nota crítica de semántica: `bias` describe al **cliente**. El dealer es el opuesto: `dealerExposure = −clientBias × exposure`.

### 4.5. Forward (`cache/gamma-forward-{T}.json`)

```ts
{
  ticker, date, spot,
  expirations: Array<{ expiration, dte, call_gex, put_gex, net_gex, p_c_ratio }>,
  putWall: number | null,    // Strike < spot con máx |put_gex|.
  callWall: number | null,   // Strike > spot con máx |call_gex|.
  limitedData: boolean        // true si < 3 expiraciones.
}
```
`p_c_ratio = |put_gex| / max(call_gex, 1e-4)`.

### 4.6. Alertas (`cache/regime-alerts.json`)

```ts
Array<{
  id: string;              // "{ticker}_{date}" o "{ticker}_{date}_DOUBLE_GEX".
  ticker, date: string;
  type: 'LONG_GAMMA_ENTRY' | 'SHORT_GAMMA_ENTRY' | 'DOUBLE_GEX';
  net_gex, ema3_net_gex, spot: number;
  previous_net_gex?: number;   // Solo DOUBLE_GEX.
}>
```

### 4.7. Snapshot de persistencia (in-memory, `/api/snapshots`)

```ts
interface Snapshot { timestamp, king, spot, netGex, ema: number; }
// Almacenado en Map<`${symbol}_${exp}`, Snapshot[]>, máx 60 entradas (~5 h a 5 min).
```
`ema`: EMA continua de la indicadora "King no cambió" (half-life 45 min). **⚠️ Volátil**: se pierde en cold starts de Vercel serverless (hallazgo R4 pendiente).

---

## 5. Fuentes de datos

### 5.1. Yahoo Finance — [DATO REAL]

- **Vía TS**: `yahoo-finance2` (`quote`, `options`) en `route.ts`.
- **Vía Python**: `yfinance` (`Ticker.history`, `.options`, `.option_chain`) en `backend/main.py`.
- Provee: **spot**, listado de expiraciones, y por strike: **IV, OI, volumen, bid, ask, strike**.
- No provee posicionamiento del dealer ni GEX. Todo lo derivado (γ, GEX, VEX) es **[CALCULADO]** por el sistema.
- Fiabilidad conocida (documentada en auditoría): IV a veces corrupta en ITM o alas 0DTE → de ahí la sanitización y la reconstrucción por paridad.

### 5.2. Unusual Whales — [DATO REAL] con normalización

Dos superficies scrapeadas:

1. **GEX agregado** (`/api/gex/{T}?timespan=1y`, `/expiry`, `/strike`): call/put GEX y vanna ya agregados por UW. El sistema los toma como verdad y solo suma/normaliza. Escala propia de UW.
2. **Tabla OI histórica por contrato** (`flow/option_chains?chain=…`): `oi` por día y una **señal de agresión** codificada en el color/ancho de la barra bid/ask. Normalización:
   - `bidAsk` = porcentaje leído del texto `%` (÷100), default 0.5.
   - `color` = comparación de `redWidth` (var(--danger)) vs `greenWidth` (var(--success)); empate (<15) → `unknown`.

### 5.3. Datos derivados por scraping (normalización de fechas) — [CALCULADO]

UW muestra fechas como `DD/MM` sin año. Reconstrucción (idéntica en `uw-parse.js`, `uw-expand.js`, `uw-window-fetch.js`): se parte del año de expiración del contrato y se **retrocede el año** cuando el mes de una fila es mayor que el de la anterior (la tabla va de más reciente a más antigua). Riesgo: si hay huecos largos, la inferencia de año puede fallar en bordes de año. **⚠️ NO DEDUCIBLE** con certeza el comportamiento exacto en huecos > 12 meses.

### 5.4. Datos calculados — [CALCULADO]

γ, vanna, GEX, VEX, King Node, Gamma Flip, IV por inversión, EMA3, HHI, percentiles.

### 5.5. Datos inferidos — [INFERIDO]

Dealer bias (`buy`/`sell`/`bias`), posicionamiento cliente, régimen, cuadrantes, escenarios, absorción, riesgo.

### 5.6. Datos mock — [MOCK]

`daily-snapshot.js::generateMockHistory` genera 25 días de historia sintética (random walk) si `regime-history-{T}.json` está vacío. **⚠️ Importante**: `daily-snapshot.js` **no está referenciado por ningún script npm** en `package.json` (pipeline actual usa `uw-fetch-gamma-data.js`, que trae GEX real de UW). Es código legado; su mock solo afectaría si alguien lo ejecuta manualmente.

---

## 6. Cálculos (detalle exhaustivo)

Para cada cálculo: objetivo, variables, fórmula, justificación, interpretación, limitaciones, suposiciones.

Constantes globales: `RISK_FREE_RATE r = 0.045` (4.5%, tasa asumida, no dinámica).

### 6.1. Tiempo a expiración `T` (`calcT`)

- **Objetivo**: fracción de año hasta el cierre de opciones (16:00 ET).
- **Variables**: `expirationDateStr` (ISO), `Date.now()`.
- **Fórmula**:
  ```
  closeUTC = (mes ∈ [4,10]) ? 20:00Z : 21:00Z      // ajuste DST por mes
  T = max(expMs − nowMs, 0) / (365.25·24·3600·1000)
  T = (T > 0) ? T : 1e-5
  ```
- **Justificación**: las opciones expiran 16:00 ET; DST se aproxima por mes (EDT abr–oct = UTC−4; EST nov–mar = UTC−5).
- **Limitaciones**: semanas borde de marzo/noviembre pueden errar ≤1 h (aceptado, fix R8).
- **Suposiciones**: año de 365.25 días; ignora feriados.

### 6.2. Gamma Black-Scholes (`calcGamma`)

- **Objetivo**: Γ de una opción europea.
- **Fórmula**:
  ```
  d1 = [ln(S/K) + (r + ½σ²)·T] / (σ·√T)
  Γ  = φ(d1) / (S·σ·√T),   φ(x) = e^(−x²/2)/√(2π)
  ```
- **Guardas**: `T ≤ 0 || σ ≤ 0 → 0`; `σ = max(σ, 0.01)`.
- **Suposiciones**: sin dividendos; misma Γ para call y put (correcto en BS).

### 6.3. Gamma Exposure `GEX`

- **Objetivo**: exposición gamma en dólares por 1% de movimiento del subyacente.
- **Fórmula**: `GEX_contrato = signo · Γ · OI · S²`, con `signo = +1` (call), `−1` (put) en convención RAW.
- **Unidades — aclaración importante**: `Γ·OI·S²` equivale al **dollar-gamma del dealer por 1% de movimiento**, porque el multiplicador de contrato (×100) y el factor por-1% (×0.01) se cancelan (100 × 0.01 = 1). Es decir, la fórmula ya está en la escala estándar tipo SpotGamma pese a no escribir esos factores explícitos.
- **Agregados**: `netGex = Σ call − Σ put` (los put ya llevan signo negativo).
- **Interpretación**: `netGex > 0` (long gamma) → dealers estabilizan (mean reversion, pinning); `< 0` (short gamma) → dealers amplifican (trend, expansión de rango).

### 6.4. Vanna (`calcVanna`)

- **Objetivo**: sensibilidad cruzada ∂²V/∂S∂σ (o ∂Δ/∂σ).
- **Fórmula** (fix auditoría C1):
  ```
  d1 = [ln(S/K) + (r + ½σ²)T]/(σ√T)
  d2 = d1 − σ√T
  vanna = −φ(d1)·d2 / σ
  ```
- **Justificación**: la forma correcta no lleva el `√T` extra que tenía la versión previa.
- **Signo intrínseco**: positivo para calls OTM / puts ITM (d2>0), negativo en el caso opuesto. Este signo **no debe destruirse con `Math.abs`** en VEX (fix R2).

### 6.5. Vanna Exposure `VEX`

- **Fórmula**: `VEX_contrato = vanna · OI · S`. (Mismo argumento de cancelación de factores que GEX; escala por punto de vol.)
- **Convención RAW** (fix R3): `VEX = (call:+1 / put:−1) · vanna · OI · S` — consistente con GEX.
- **Convención DEALER**: `VEX = −clientBias · vanna · OI · S` (sin `abs`).
- **Dónde se calcula**: solo client-side (`GammaMatrix.tsx`, `analysisSnapshot` en `page.tsx`) y en `daily-snapshot.js`. La API devuelve `vex=0`.

### 6.6. Sanitización de IV (`sanitizeIV`)

- **Fórmula**: `iv ∈ [0.03, 4.0] ? iv : 0`. (3%–400%.)
- **Justificación**: Yahoo entrega IV decimal; valores fuera de rango son corruptos o alas no fiables (fix C4/C5).

### 6.7. IV por inversión Newton-Raphson (`calcIVFromPrice`) — fix R1

- **Objetivo**: derivar σ desde el mid-price cuando Yahoo no da IV válida.
- **Proceso**:
  ```
  intrinsic = max(0, call? S−K·e^(−rT) : K·e^(−rT)−S)
  if mid < intrinsic − 0.01 → 0    // precio bajo intrínseco = corrupto
  σ₀ = max(0.05, √(2π/T)·mid/S)    // semilla Brenner-Subrahmanyam
  repetir ≤100:
     price = bsPrice(σ); vega = S·√T·φ(d1)
     σ -= (price − mid)/vega;  clamp σ ∈ [0.005, 5.0]
     corte si |diff| < 1e-6
  return sanitizeIV(σ)
  ```
- **Justificación**: garantizar γ no nula en el lado ITM (antes γ=0 rompía el perfil).

### 6.8. Unificación IV por paridad call/put — fix R1 (solo `route.ts`)

- **Proceso**: por cada strike se elige el lado **OTM** (call si `strike ≥ spot`, put si `<`), se toma su IV (o se deriva por 6.7); si falla, fallback al lado ITM. Ambas patas del strike comparten esa `unifiedIV` → `γcall ≈ γput` (paridad garantizada). El `backend/main.py` hace una versión más simple (usa `otm_iv` sin Newton-Raphson).

### 6.9. King Node

- **Objetivo**: strike de máxima concentración de gamma (imán de precio).
- **Fórmula**: `argmax_strike |Σ_type GEX(strike)|`.
- **Interpretación**: nivel de pinning más probable si el régimen es long-gamma.

### 6.10. Gamma Flip (`findGammaFlip`) — fix C7

- **Objetivo**: spot teórico donde `netGEX(S) = 0` (frontera long/short gamma).
- **Proceso**: barre `S ∈ [0.8·spot, 1.2·spot]` en 40 pasos; en cada cruce de signo refina por bisección (8 iteraciones); de todos los cruces, devuelve **el más cercano al spot** (antes devolvía el primero).
- **Limitación**: rango fijo ±20% puede no capturar flips lejanos; malla de 40 pasos limita resolución inicial.

### 6.11. Dealer Bias (`dealer-builder.js`) — [INFERIDO], fix R6

- **Objetivo**: reconstruir buy/sell acumulados del cliente por contrato a partir de deltas de OI.
- **Variables**: `history[]` (date, oi, color, bidAsk), `DECAY_HALF_LIFE_DAYS = 20`.
- **Proceso**:
  ```
  // Prior día-0 tipo SqueezeMetrics (no 50/50):
  isCall ? {buy=0, sell=oi₀} : {buy=oi₀, sell=0}
  para cada día i→i+1:
     delta = oi[i+1] − oi[i];  si delta==0 continuar
     recencyWeight = exp(−ageInDays · ln2 / 20)
     buyPct/sellPct según color (green→buyPct=bidAsk; red→sellPct=bidAsk; unknown→0.5)
     delta>0: buy += delta·buyPct·w;  sell += delta·sellPct·w
     delta<0: cierre proporcional al split actual, ·w;  clamp buy,sell ≥ 0
  // Renormalización final a lastOI:
  escala buy,sell para que buy+sell = lastOI
  bias = (buy − sell) / lastOI      ∈ [−1, 1]
  ```
- **Interpretación**: `bias > 0` cliente net-long ese contrato; `< 0` net-short.
- **Limitaciones documentadas** (`dealer_math_explanation.txt`): el clamp a 0 destruye restas y puede inflar el inventario; el cierre proporcional es una suposición conservadora. Antes de la renormalización (R6), `buy+sell` podía exceder `lastOI`.
- **⚠️ Discrepancia doc/código**: `dealer_math_explanation.txt` describe la versión previa (prior 50/50, sin decay, sin renormalización). El código actual ya incorpora R6.

### 6.12. Aplicación de exposición dealer

- **Fórmula base** (`dealer-engine.ts`): `dealerGex = rawGex · bias`, `dealerVex = rawVex · bias`.
- **Fórmula usada en frontend** (`getExposureValue`): `dealer = −clientBias · |baseValue|` (GEX) y `−clientBias · baseValue` (VEX). Default sin dato UW: cliente `call=−1`, `put=+1` (prior SqueezeMetrics: cliente corto calls, largo puts).
- **⚠️ Inconsistencia**: `dealer-engine.ts::applyDealerExposure` multiplica por `+bias`, mientras el frontend multiplica por `−clientBias`. `applyDealerExposure` **no se usa** en el flujo principal (el frontend implementa su propia versión). Ver §16.

### 6.13. Gamma Regime Engine (`computeGammaRegime`) — [INFERIDO/HEURÍSTICO]

Requiere `history.length ≥ 20`. Sub-cálculos:

1. **Régimen**: `ema3NetGex ≥ 0 ? LONG_GAMMA : SHORT_GAMMA`.
2. **Delta GEX**: `net_gex_hoy − net_gex_ayer`.
3. **Media móvil 30d de |net_gex|**: `rollingAvgAbsNetGex30d`.
4. **Umbral mínimo**: `0.10 · rollingAvgAbsNetGex30d`.
5. **Regime shift**: régimen cambió **y** `|ema3| > umbral`.
6. **Shift strength (normalizado)**: `|deltaGex| / rollingAvgAbsNetGex30d`; etiquetas [HEURÍSTICO]: ≥2.5 Extremo, ≥1.0 Alto, ≥0.25 Moderado, else Bajo.
7. **Duración**: sesiones consecutivas con mismo signo de `ema3`.
8. **Estabilidad 20d**: fracción de los últimos 20 días con mismo régimen; etiquetas ≥0.8 Muy estable, ≥0.5 Estable, ≥0.2 Inestable, else Muy inestable.
9. **VEX pressure**: `|net_vex| / max(|net_gex|, 1e-4)`. Cuadrante GEX-VEX [HEURÍSTICO]:
   - LONG: <0.05 "Pin Estable", >0.20 "Pin Frágil", else "Pin de Transición".
   - SHORT: <0.05 "Direccional Controlado", >0.20 "Aceleración Explosiva", else "Direccional Activo".
10. **Percentiles p10/p90** de net_gex (30d) para alertas de extremo.
11. **Grid step**: por ticker (SPY/QQQ=1, TSLA/GOOGL=5, else 1) salvo override.
12. **Inferencias forward**: `netGexForward = Σ net_gex (expiraciones salvo la primera)`; si su signo difiere del de hoy → "presión hacia" el régimen opuesto. `daysToPressure` = días de trading (≈5/7 de días calendario) hasta la expiración con máx |net_gex|. `pcForwardTrend` = media de `p_c_ratio` de las 3 primeras expiraciones.
13. **5 alertas** (ver §7 y §8): LONG/SHORT_GAMMA_ENTRY, EXTREME_NEGATIVE, EXTREME_POSITIVE, FORWARD_REGIME_PRESSURE.

**⚠️ Escala**: este motor opera sobre `net_gex` de UW (regime-history), **no** sobre el GEX Yahoo del Dealer Analysis. `page.tsx` explícitamente **no mezcla** ambas escalas (comentario en `regimeData`).

### 6.14. Métricas del Dealer Analysis (`analysisSnapshot` en `page.tsx`)

Todas client-side, sobre la cadena Yahoo + dealer cache, para la expiración activa. `gridStep` = mediana de diferencias de strikes consecutivos. `nearSpotRange = spot·0.015`. `straddleATM ≈ S·σ_ATM·√T·√(2/π)`.

- **6.14.1 Dominancia**: `|GEX(King)| / Σ|GEX| · 100`. Etiquetas [HEURÍSTICO]: <20 Difuso, ≤40 Normal, ≤60 Concentrado, else Frágil.
- **6.14.2 VEX Pressure** (fix C8): `|netVex| / max(1e-10, |netGex|)`. <0.05 "Precio domina", ≤0.20 "Mixto", else "Vol domina".
- **6.14.3 Sesgo estructural** (fix 6.3): `bias = (Σ GEX⁺ − Σ|GEX⁻|) / Σ|GEX|`, con signo. Etiquetas: >50 Positivo Dominante, >20 Positivo, <−50 Negativo Dominante, <−20 Negativo, else Neutral.
- **6.14.4 Densidad (HHI)** (fix 6.9): `HHI = Σ share²` con `share = |GEX_i|/Σ|GEX|`; `HHI_norm = (HHI − 1/N)/(1 − 1/N)`. Clases [HEURÍSTICO]: Dispersa/…/Concentrada.
- **6.14.5 Absorción**: `absorptionScore = Σ|top3 no-King| / (|King| + Σ|top3 no-King|)`. Etiquetas ≥0.8 Muy Alta … <0.2 Ausente.
- **6.14.6 Escenarios** (superior/inferior): nodos visibles (|GEX| ≥ 10% del máx o dentro de nearSpotRange); cadena de absorción hacia arriba (máx 3 nodos positivos con gap ≤ 2·gridStep); hacia abajo detecta el primer hueco > gridStep entre nodos visibles como "target vacío" e "interacción".
- **6.14.7 Mapa estructural**: bounds = [primer, último] nodo visible; `spotPositionPercent = (spot − lower)/(width)·100`.
- **6.14.8 Persistencia + Spot Drift** (fix 6.6): lee `serverPersistence` (EMA King Node de `/api/snapshots`). `drift = spot − prevSpot`; clases Estable/Activo/Expansivo. Persistencia: Persistente (ema≥0.7) / Estable / Reciente.
- **6.14.9 Distancia al King**: `spot − King`; clases por proximidad relativa.
- **6.14.10 Riesgo estructural (multiplicativo)**:
  ```
  fragilidad   = |GEX(King)| / Σ|GEX|
  reactividad  = max(0, −netGEX) / Σ|GEX|        // porción negativa de netGEX (0 si netGEX ≥ 0)
  proximidad   = exp( −|spot − King| / max(straddleATM, gridStep) )   // decaimiento exponencial
  inestabilidad= 1 − ema(persistencia King)
  riskScore = clamp01( 1 − (1 − fragilidad·reactividad)·(1 − inestabilidad·proximidad) )
  ```
  El factor `reactividad` hace que un régimen positivo (netGEX ≥ 0, pin) anule el canal de fragilidad → riesgo bajo. `proximidad` es máxima (=1) cuando spot = King y decae con la distancia normalizada al straddle ATM.
  Etiquetas: ≥0.75 Crítico, ≥0.50 Alto, ≥0.25 Moderado, else Bajo.
- **6.14.11 Soportes/Resistencias**: nodos por encima/debajo del spot con `|GEX| ≥ 1% de |GEX(King)|`, ponderados `|GEX|/|GEX(King)|·100`.

### 6.15. Persistencia del King Node (`/api/snapshots`) — EMA temporal

- **Fórmula**: `decay = exp(−Δt·ln2 / (45 min))`; `ema = decay·ema_prev + (1−decay)·[King==King_prev]`.
- **Interpretación**: mide cuán estable ha sido el King Node en las últimas horas. `count` = sesiones consecutivas con mismo King; `prevKing` = último King distinto.

### 6.16. Detección de shifts / doble-GEX (`check-regime-shifts.js`)

- **Shift**: signo de `net_gex` (crudo, no EMA3) cambia día a día **y** `|net_gex_hoy| > 0.10·media|net_gex|30d`.
- **Double GEX**: mismo signo y `|hoy|/|ayer| ≥ 1.8`.
- **Justificación de usar crudo**: alerta el mismo día que cambia el color de la barra (a costa de más falsos positivos que el EMA3).

---

## 7. Flujo interno del Dealer Analysis (paso a paso)

El panel se construye en el `useMemo` `analysisSnapshot` (`page.tsx` líneas ~963–1487). Cada paso depende del anterior:

```
Spot (Yahoo)
   ↓
Cadena activa (expiración seleccionada) → strikesSorted, gridStep, nearSpotRange
   ↓
Exposición por strike:  getExposureValue()  (RAW o DEALER via bias cache)
   → strikeData[] = { strike, gex, vex, distanceToSpot }
   ↓
King Node  = argmax |gex|;  maxPosNode, maxNegNode
   ↓
Distancia Spot↔King  (clase por proximidad relativa a straddleATM)
   ↓
Dominancia  = |gex(King)| / Σ|gex|   → {Difuso|Normal|Concentrado|Frágil}
   ↓
Sesgo estructural  = (Σgex⁺ − Σ|gex⁻|)/Σ|gex|   → {Positivo…Negativo Dominante}
   ↓
Persistencia (EMA King desde /api/snapshots) + Spot Drift
   ↓
Escenarios:
   • Superior: cadena de absorción de nodos positivos (gap ≤ 2·gridStep)
   • Inferior: primer hueco > gridStep = target "vacío" + interacción
   ↓
Presión VEX/GEX  = |netVex|/|netGex|   → {Precio|Mixto|Vol} domina
   ↓
Mapa estructural: bounds visibles, spotPositionPercent, densidad HHI, compresión
   ↓
Absorción score (top3 no-King)  → {Ausente…Muy Alta}
   ↓
Riesgo estructural (multiplicativo: fragilidad·reactividad × inestabilidad·proximidad)
   ↓
Soportes/Resistencias (nodos ≥1% del King, ponderados)
   ↓
Salida dual:  objeto estructurado (vista Visual)  +  textOutput (vista Texto)
```

Un `useEffect` de validación compara la vista Visual contra el `textOutput` (Dominancia, Spot Drift, Presión, Sesgo, Persistencia) y emite `console.warn` si difieren — garantía de consistencia entre ambas representaciones.

---

## 8. Algoritmos

### 8.1. `findGammaFlip` (barrido + bisección)
- **Objetivo**: raíz de `netGEX(S)=0` más cercana al spot.
- **Entradas**: `spot`, `contracts[] {strike, iv, oi, type, T}`.
- **Proceso**: 40 muestras en [0.8S, 1.2S]; en cada cambio de signo, 8 iteraciones de bisección; se elige el cruce de menor `|c − spot|`.
- **Salida**: `number | null`.
- **Complejidad**: O(40·M + 8·k·M) con M=#contratos, k=#cruces ≈ O(M).
- **Errores posibles**: sin cruces → null; IV=0 excluye contratos.

### 8.2. `computeGammaRegime`
- **Objetivo**: clasificar régimen + generar alertas.
- **Entradas**: `history[]` (≥20), `forwardExpirations[]`, `currentSpot`, `gridStep?`.
- **Salida**: `GammaRegimeOutput | null`.
- **Complejidad**: O(n) (una pasada + ventanas 20d/30d).
- **Errores**: `history < 20 → null`; percentiles con array vacío → 0.

### 8.3. `buildDealer` (reconstrucción de inventario)
- **Objetivo**: buy/sell/bias por contrato.
- **Complejidad**: O(H) con H=días de historia.
- **Errores**: `history < 2 → SKIP`; filas con campos undefined → parse fail; `lastOI=0 → bias=0`.

### 8.4. Construcción de matriz (`GammaMatrix.tsx`)
- **Objetivo**: `Map<strike, Map<exp, cell>>` con netGex/netVex por celda, King global, máx pos/neg por columna, air pockets.
- **Complejidad**: O(C) para poblar + O(S·E) para clasificar (S strikes, E expiraciones).
- **Air pocket**: `|val| < 5% del máx`. Visibilidad `relevantOnly`: oculta celdas `< 10% del máx` salvo King, máx pos/neg, o `|strike−spot| ≤ 5`.

### 8.5. Cola de captura con reanudación (`uw-window-fetch.js`)
- **Objetivo**: scrapear N contratos con checkpoint y recuperación de sesión.
- **Estado**: `capture_queue.json` (cola) + `capture_state.json` (completados). Checkpoint cada 50; reintento de contrato si detecta logout.
- **Complejidad**: O(Q) navegaciones, dominado por I/O de red (~4 s/contrato).

### 8.6. Resolución de rutas de caché (`cache-resolver.js`)
- Parsea OCC `{TICKER}{YYMMDD}{C|P}{strike}` → `{ticker, expiry}` y mapea a `baseDir/ticker/expiry/`. Soporta layout viejo (plano) y nuevo (jerárquico).

---

## 9. Fórmulas (formulación matemática)

```
d1 = [ln(S/K) + (r + σ²/2)·T] / (σ·√T)
d2 = d1 − σ·√T
φ(x) = e^(−x²/2) / √(2π)                        (PDF normal estándar)
N(x)  = 1 − φ(x)·(b1 t + b2 t² + b3 t³ + b4 t⁴ + b5 t⁵),  t = 1/(1+p|x|)
        (Abramowitz & Stegun 26.2.17, |error| < 7.5·10⁻⁸)

Γ      = φ(d1) / (S·σ·√T)
Vanna  = −φ(d1)·d2 / σ
Vega   = S·√T·φ(d1)

BS_call = S·N(d1) − K·e^(−rT)·N(d2)
BS_put  = K·e^(−rT)·N(−d2) − S·N(−d1)

GEX_i  = ε · Γ_i · OI_i · S² ,  ε = +1 (call) | −1 (put)
VEX_i  = ε · Vanna_i · OI_i · S
netGEX = Σ_i GEX_i ;   netVEX = Σ_i VEX_i

DealerExp_i = −bias_cliente_i · Exp_i        (frontend)
bias_cliente = (buy − sell) / lastOI  ∈ [−1, 1]

T = max(exp − now, 0) / (365.25·86400)

EMA_α(x_t) = α·x_t + (1−α)·EMA_{t−1},  α = 0.5    (ema3_net_gex)

Newton-Raphson IV:  σ_{k+1} = σ_k − (BS(σ_k) − mid) / Vega(σ_k)
   semilla:  σ₀ = max(0.05, √(2π/T)·mid/S)        (Brenner-Subrahmanyam)

Dominancia   = |GEX_King| / Σ|GEX| · 100
HHI          = Σ (|GEX_i|/Σ|GEX|)²
HHI_norm     = (HHI − 1/N) / (1 − 1/N)
Sesgo        = (Σ GEX⁺ − Σ|GEX⁻|) / Σ|GEX|
VEXpressure  = |netVEX| / |netGEX|
Absorción    = Σ|top3_noKing| / (|GEX_King| + Σ|top3_noKing|)
straddleATM  = S · σ_ATM · √T · √(2/π)
fragilidad   = |GEX_King| / Σ|GEX| ;   reactividad = max(0, −netGEX)/Σ|GEX|
proximidad   = exp(−|spot−King| / max(straddleATM, gridStep)) ;  inestabilidad = 1 − ema_King
Riesgo       = 1 − (1 − fragilidad·reactividad)·(1 − inestabilidad·proximidad)
EMA_King(t)  = e^(−Δt·ln2/HL)·EMA_{t−1} + (1 − e^(−Δt·ln2/HL))·[King_t = King_{t−1}],  HL = 45 min
ShiftStrength= |ΔnetGEX| / avg|netGEX|_{30d}
p_c_ratio    = |put_gex| / max(call_gex, 10⁻⁴)
```

---

## 10. Inferencias — clasificación de la naturaleza de cada dato

| Categoría | Ejemplos concretos | Origen |
|-----------|--------------------|--------|
| **Reales** | spot, IV, OI, volumen, bid/ask (Yahoo); OI histórico, color bid/ask, GEX/vanna agregado (UW) | Medición externa |
| **Calculados** | Γ, vanna, GEX, VEX, King Node, Gamma Flip, IV-inversión, net/ema3, HHI, percentiles, walls, p_c_ratio | Fórmula determinista sobre reales |
| **Inferidos** | dealer buy/sell/bias, exposición dealer, régimen LONG/SHORT, forward pressure, days-to-pressure | Modelo sobre reales+calculados |
| **Heurísticos** | umbrales de Dominancia (20/40/60), cuadrantes VEX (0.05/0.20), shift strength (0.25/1.0/2.5), estabilidad (0.2/0.5/0.8), riesgo, densidad, umbral 10% de visibilidad, ratio DOUBLE_GEX 1.8 | Calibración a criterio (R7 pendiente) |
| **Aproximados** | T con DST por mes (±1h en bordes), days-to-pressure (5/7 días calendario), inferencia de año en fechas UW, straddleATM como proxy de σ | Simplificación consciente |
| **Mock** | `generateMockHistory` (25 días random walk) | Sintético (código legado) |

**Regla de oro para mantenimiento**: nunca presentar un dato Inferido/Heurístico con la misma autoridad que uno Real. El dealer bias y todo el régimen son **estimaciones**, no verdades de mercado.

---

## 11. Dependencias entre módulos

### 11.1. Matriz de dependencias

| Módulo | Depende de | Es crítico para |
|--------|-----------|-----------------|
| `gex-engine.ts` | — (autónomo) | `route.ts`, `GammaMatrix.tsx`, `page.tsx`, `daily-snapshot.js` (replica) |
| `dealer-engine.ts` | `fs`, `cache/dealer/**` | `/api/dealer` |
| `gamma-regime-engine.ts` | — (autónomo) | `page.tsx` (regimeData), `GammaRegimePanel` |
| `route.ts` (`/api/options`) | `gex-engine.ts`, Yahoo | Todo el frontend + scrapers (spot/strikes) |
| `page.tsx` | `gex-engine`, `gamma-regime-engine`, `GammaMatrix`, todas las API routes | UI (raíz) |
| `GammaMatrix.tsx` | `gex-engine.ts`, dealerCache | Vista matriz |
| `uw-window-fetch.js` | `/api/options`, `cache-resolver.js`, Playwright | `cache/uw/**` |
| `dealer-builder.js` | `cache/uw/**`, `cache-resolver.js` | `cache/dealer/**` |
| `uw-fetch-gamma-data.js` | `uw-session.js`, Playwright, UW | `regime-history`, `gamma-forward` |
| `check-regime-shifts.js` | `regime-history-*.json` | `regime-alerts.json` → `NotificationBell` |
| `cache-resolver.js` | — | `uw-window-fetch`, `uw-expand`, `dealer-builder` |
| `backend/main.py` | yfinance | Alternativa local de `/api/options` |

### 11.2. Módulos críticos (un fallo rompe muchos consumidores)
- `gex-engine.ts` — corazón matemático (single source of truth); un bug aquí propaga a API, matriz y análisis.
- `route.ts /api/options` — sin él no hay cadena viva ni cola de scraping.
- `cache-resolver.js` — rutas de lectura/escritura de todo el caché de contratos.

### 11.3. Módulos modificables con bajo riesgo (aislados)
- `GammaRegimePanel.tsx`, `GammaRegimeChart.tsx`, `NotificationBell.tsx` — presentación pura.
- `gamma-capture-meta`, `cron/trigger-*` — infraestructura, sin acoplamiento a cálculo.
- `daily-snapshot.js` — legado, no cableado.

### 11.4. Duplicación de lógica (deuda técnica)
La lógica de Black-Scholes está **replicada** en 3 lugares: `gex-engine.ts` (TS canónico), `backend/main.py` (Python), `daily-snapshot.js` (copia JS). La extracción de tabla UW está **duplicada casi idéntica** en `uw-parse.js`, `uw-expand.js` y `uw-window-fetch.js`. Ver §16.

---

## 12. Frontend

### 12.1. Paneles y qué muestran

| Panel / componente | Muestra | Consume | Calcula en cliente |
|--------------------|---------|---------|--------------------|
| Matriz GEX/VEX (`GammaMatrix`) | Heatmap strike×exp; King, máx pos/neg, air pockets | `matrixRawData` (`/api/options` por exp) + dealerCache | VEX (vanna·OI·S), agregación RAW/DEALER, King, visibilidad |
| Dealer Analysis (`analysisSnapshot`) | Dominancia, sesgo, escenarios, mapa, riesgo, S/R | cadena viva + dealerCache + `/api/snapshots` | Todo (§6.14) |
| Gamma Regime (`GammaRegimePanel`) | Régimen, cuadrante, shift, estabilidad, forward | `regimeData` = `computeGammaRegime` | Nada (recibe objeto ya calculado) |
| Gamma Regime Chart | Serie histórica net_gex + barras forward | regime-history + forward | Escalas/render SVG |
| Notification Bell | Alertas de flip/doble-GEX | `/api/regime-alerts` | Conteo no leídas (localStorage) |

### 12.2. Qué calcula el frontend hoy
- VEX completo (la API devuelve 0) — decisión de diseño.
- Toda la interpretación del Dealer Analysis.
- Agregación RAW↔DEALER de la matriz.

### 12.3. Qué NO debería calcular el frontend (recomendación)
- No debería recomputar Black-Scholes/VEX en el navegador para cada matriz: ese trabajo debería venir pre-agregado del backend para evitar divergencias de escala y coste en clientes lentos. Hoy la API ya devuelve `gex` por contrato pero **no** `vex`; idealmente el backend devolvería VEX y agregados dealer para que el cliente solo renderice.
- La persistencia (`/api/snapshots`) no debería vivir en memoria del proceso (se pierde en cold start): debería venir calculada y persistida desde backend.

### 12.4. Estado y persistencia de UI
`localStorage` guarda: símbolo, expiración, filtros, modo exposición, modo vista, selección de matriz, ventana de strikes, formato display, tickers recientes, IDs de alertas leídas.

---

## 13. Validaciones

| Situación | Manejo | Ubicación |
|-----------|--------|-----------|
| `NaN`/`Inf`/`None` en valores Yahoo | → 0.0 | `clean_value` (Python), `|| 0` (TS) |
| IV fuera de [0.03, 4.0] | → 0 (γ=0) | `sanitizeIV` |
| IV inválida con bid/ask válidos | Newton-Raphson desde mid | `calcIVFromPrice` |
| Contrato junk (`bid==0 && oi==0`) | Descartado | `route.ts`/`main.py` |
| Precio < intrínseco − 0.01 | IV → 0 (corrupto) | `calcIVFromPrice` |
| `T ≤ 0` | → 1e-5 | `calcT` |
| `σ ≤ 0` | γ/vanna → 0; `σ=max(σ,0.01)` en BS | `calcGamma`/`calcVanna` |
| OI = 0 en dealer | `bias = 0` (division guard `lastOI>0`) | `buildDealer`, `calculateDealerBias` |
| `history < 2` (dealer) | SKIP contrato | `dealer-builder.js` |
| `history < 20` (régimen) | `computeGammaRegime → null`; panel muestra "faltan N sesiones" | engine + `GammaRegimePanel` |
| `history < 21` (shifts) | Sin alertas | `check-regime-shifts.js` |
| Sin expiraciones | Respuesta vacía estructurada | `route.ts`/`main.py` |
| VEX inexistente | `net_gex` como denominador con `max(·, 1e-4/1e-10)` | VEX pressure |
| Fila UW sin campos | `INVALID_ROW`, parse fail | `dealer-builder.js` |
| Símbolo faltante en API | HTTP 400 | routes |
| Error Yahoo | HTTP 400 (no 500) | `route.ts`/`main.py` |
| Build dealer en Vercel | Bloqueado (FS read-only) | `/api/dealer/build` |
| Build concurrente | `buildLock` / HTTP 429 | `/api/dealer/build` |

**Huecos de validación conocidos** (§16): no hay validación de coherencia temporal fuerte en la inferencia de año de fechas UW; no hay verificación de que `net_gex` de régimen y GEX de Dealer Analysis usen la misma escala (se evita mezclarlos por convención, no por chequeo).

---

## 14. Escalabilidad

### 14.1. Agregar un ticker nuevo
1. **Régimen**: añadir el símbolo a la lista del script `uw:daily:gamma` en `package.json`. `check-regime-shifts.js` lo toma automáticamente (deriva la lista de los archivos `regime-history-*.json`).
2. **OI/Dealer**: añadirlo a `config/capture_plan.json::tickers` (con `enabled:true`). El grid step por defecto vive en `gamma-regime-engine.ts` (SPY/QQQ=1, TSLA/GOOGL=5, else 1) — añadir caso si el tick difiere.
3. **UI**: opcionalmente al `<optgroup>` de `page.tsx` y a `BASE_TICKERS`.

### 14.2. Agregar un cálculo nuevo
- Si es matemático puro y reutilizable → `gex-engine.ts` (mantener como single source of truth; replicar en Python solo si el backend lo necesita).
- Si es interpretativo del Dealer Analysis → nuevo bloque en `analysisSnapshot` devolviendo un campo en el objeto, más su render.

### 14.3. Agregar otra fuente de datos
- Crear un script en `scripts/` que escriba a `cache/` en el formato de §4, y una API route de lectura en `src/app/api/`. Mantener la frontera Alimentador/Post-proceso (§2).

### 14.4. Agregar APIs
- Nueva carpeta `src/app/api/{nombre}/route.ts` con `export const dynamic = 'force-dynamic'` si lee `cache/`.

### 14.5. Agregar paneles/indicadores
- Componente en `src/app/components/`, alimentado por props (patrón de `GammaRegimePanel`: recibe el objeto ya calculado, sin lógica de negocio dentro).

### 14.6. Límites de escala conocidos
- Scraping secuencial (~4 s/contrato) no escala a miles de contratos; la Etapa 2 ya tarda ~1 h.
- Persistencia como JSON en Git crece el repo indefinidamente (cada día commitea `cache/`); a mediano plazo requiere una base de datos o almacenamiento externo.
- `/api/snapshots` in-memory no es multi-instancia ni persistente.

---

## 15. Código: intención, razones y alternativas

- **Dos backends de GEX (Python + TS)**: intención — redundancia y desarrollo local (`npm run dev` levanta ambos con `concurrently`). En producción/CI solo corre `route.ts` (Vercel). *Alternativa*: unificar en TS y eliminar Python (ventaja: una sola fuente de verdad; desventaja: perder el fallback local y pandas). El Python quedó rezagado (sin Newton-Raphson, sin VEX).
- **VEX calculado en cliente**: intención — evitar recomputar vanna en el server por cada request de matriz multi-expiración. *Desventaja*: coste en cliente y riesgo de divergencia. *Alternativa*: devolver VEX y agregados dealer desde la API.
- **Persistencia como archivos en Git**: intención — cero infraestructura de DB, historial versionado gratis, Vercel sirve estático. *Desventaja*: repo pesado, no apto para escala. *Alternativa*: Postgres/Redis o blob storage.
- **Dealer bias por reconstrucción de OI**: intención — aproximar posicionamiento sin datos de flujo dealer reales (que no existen públicamente). Modelo SqueezeMetrics-like con prior por tipo y decay de recencia. *Alternativa*: usar el GEX agregado de UW directamente (ya lo hace el motor de régimen) y abandonar la reconstrucción por contrato.
- **Gamma Flip por barrido+bisección** en vez de solución cerrada: no hay forma cerrada (netGEX(S) es suma no lineal); el barrido garantiza encontrar múltiples cruces y elegir el relevante.
- **EMA α=0.5 llamada "ema3"**: α=2/(N+1) con N=3 da α=0.5 → efectivamente EMA de 3 períodos; el nombre es correcto.
- **Alertas con signo crudo (no EMA3) en `check-regime-shifts`**: intención — reaccionar el mismo día que cambia la barra; trade-off explícito de más falsos positivos.
- **Stealth Playwright (`navigator.webdriver=undefined`, UA real, viewport fijo)**: necesario porque UW sirve respuestas degradadas/vacías a headless detectable en CI.

---

## 16. Auditoría técnica y mejoras posibles

### 16.1. Duplicación de lógica
- **Black-Scholes en 3 lenguajes/archivos** (`gex-engine.ts`, `main.py`, `daily-snapshot.js`). *Riesgo*: fixes que se aplican en uno y no en otros (de hecho `main.py` y `daily-snapshot.js` no tienen las mejoras R1). *Fix*: designar `gex-engine.ts` como única fuente; el backend Python debería o bien eliminarse o importar valores del TS.
- **Extracción de tabla UW duplicada** en `uw-parse.js`, `uw-expand.js`, `uw-window-fetch.js` (el bloque `page.evaluate` es casi idéntico). *Fix*: extraer a un módulo compartido inyectado con `addScriptTag`.
- **Lógica de login UW** repetida (`uw-session.js` la centraliza, pero `uw-window-fetch.js` y `uw-expand.js` aún tienen copias propias). *Fix*: consolidar en `uw-session.js`.

### 16.2. Inconsistencias / posibles errores de interpretación
- **`applyDealerExposure` vs frontend**: `dealer-engine.ts` hace `rawGex·bias`; el frontend hace `−clientBias·|raw|`. Semánticas distintas de signo. `applyDealerExposure` está esencialmente muerto; conviene borrarlo o alinearlo para evitar que un futuro consumidor lo use mal.
- **`daily-snapshot.js` (mock + escala Yahoo)**: si alguien lo ejecuta, siembra 25 días **mock** y mezcla escala Yahoo con el motor de régimen (que espera escala UW). *Fix*: eliminar el script o marcarlo claramente como test-only.
- **`king_node: null` en regime-history** de la fuente actual (UW): las alertas EXTREME_* del engine usan `king_node` y distancia al King; con `king_node=null` esas alertas pueden comportarse de forma indefinida. **⚠️ Verificar** el comportamiento cuando `king_node` es null en `computeGammaRegime` (usa `todayEntry.king_node` sin guard explícito).

### 16.3. Errores estadísticos / financieros
- **Umbrales heurísticos sin backtest (R7 pendiente)**: todas las fronteras de clasificación (dominancia, cuadrantes, riesgo, shift strength) son a ojo. *Fix*: calibrar contra realized-vol/retornos posteriores una vez haya suficiente historial persistido.
- **`r = 4.5%` constante**: no refleja la curva de tasas real; error pequeño en griegas pero sistemático. *Fix*: leer un yield de referencia (o ignorar, dado el impacto marginal en Γ).
- **Sin dividendos en BS**: para subyacentes con dividendo, d1/d2 tienen sesgo. *Fix*: incorporar `q` (dividend yield) si se amplía a tickers con dividendo relevante.
- **Reconstrucción dealer con clamp a 0**: sesga el inventario al alza y puede fijar `bias=±1` artificialmente (ver `dealer_math_explanation.txt`). *Fix*: modelar cierres con un método que no destruya masa (p. ej. prorrateo sin clamp con reconciliación final más robusta).
- **VEX pressure y comparabilidad de unidades**: ya corregido (C8) al usar el ratio puro `|netVex|/|netGex|`; mantener la vigilancia si se cambian las fórmulas de escala.

### 16.4. Robustez / arquitectura
- **R4 — persistencia in-memory** (`/api/snapshots`): se pierde en cold starts serverless → Spot Drift y Persistencia del Dealer Analysis pueden reiniciarse. *Fix*: mover a KV/Redis o a los snapshots diarios ya persistidos.
- **Persistencia como commits a Git**: crecimiento ilimitado del repo y contención de push (los workflows ya rebasan para evitar "fetch first"). *Fix*: DB o blob storage con retención.
- **Scraping frágil**: depende de clases CSS de UW (`var(--danger)`, `emerald`, etc.) y del DOM; cualquier rediseño de UW rompe la extracción silenciosamente. *Fix*: preferir la intercepción de endpoints JSON (ya usada en `uw-fetch-gamma-data.js`) sobre el scraping de tabla del `option_chains`.
- **Inferencia de año en fechas UW**: heurística que puede fallar en huecos largos. *Fix*: capturar el año real si UW lo expone en algún atributo/tooltip.

### 16.5. Rendimiento / cuellos de botella
- **Etapa 2 (~1 h)**: navegación secuencial contrato a contrato. *Fix*: paralelizar con varias páginas/contextos respetando rate limits, o usar endpoints JSON de UW si existen para OI histórico.
- **VEX recomputado en cliente** por cada render de matriz multi-exp. *Fix*: memoization ya existe (`useMemo`), pero mover el cálculo al server reduce carga en clientes.
- **`page.tsx` monolítico (2680 líneas)**: dificulta mantenimiento y test. *Fix*: extraer `analysisSnapshot` a `src/lib/dealer-analysis-engine.ts` (testeable, sin React), como ya se hizo con `gamma-regime-engine.ts`.

### 16.6. Testing (ausencia)
No hay suite de tests automatizados (los archivos en `scratch/` son pruebas manuales ad-hoc). *Fix*: tests unitarios de `gex-engine` (γ/vanna/IV contra valores de referencia), `gamma-regime-engine` (fixtures de historia) y `dealer-builder` (secuencias OI conocidas).

### 16.7. Priorización sugerida
1. Extraer `analysisSnapshot` a un motor testeable + tests de `gex-engine`.
2. Resolver R4 (persistencia durable).
3. Verificar/blindar `computeGammaRegime` ante `king_node=null`.
4. Unificar/eliminar el Black-Scholes de Python y el `daily-snapshot.js` legado.
5. Migrar la persistencia histórica fuera de Git.
6. Calibrar empíricamente los umbrales heurísticos (R7).

---

## Apéndice A — Índice de archivos clave

| Archivo | Rol |
|---------|-----|
| `src/lib/gex-engine.ts` | Motor BS canónico (γ, vanna, IV, GEX, flip) |
| `src/lib/dealer-engine.ts` | Carga/guarda dealer cache; bias helper |
| `src/lib/gamma-regime-engine.ts` | Motor de régimen de gamma + alertas |
| `src/app/api/options/route.ts` | GEX en vivo (producción) |
| `backend/main.py` | GEX en vivo (Python, local, legado) |
| `src/app/page.tsx` | Dashboard + Dealer Analysis (analysisSnapshot) |
| `src/app/components/GammaMatrix.tsx` | Matriz heatmap GEX/VEX |
| `src/app/components/GammaRegimePanel.tsx` | Panel de régimen |
| `src/app/components/NotificationBell.tsx` | Alertas de régimen |
| `scripts/uw-fetch-gamma-data.js` | Scrape GEX agregado UW → régimen |
| `scripts/uw-window-fetch.js` | Scrape OI histórico por contrato |
| `scripts/dealer-builder.js` | OI histórico → dealer bias |
| `scripts/check-regime-shifts.js` | Detección de flips → alertas |
| `scripts/cache-resolver.js` | Rutas de caché OCC |
| `scripts/daily-snapshot.js` | Legado: snapshot Yahoo + mock (no cableado) |
| `config/capture_plan.json` | Tickers/expiraciones/strikes de captura OI |
| `.github/workflows/daily-update.yml` | Orquestación batch diaria |
| `.github/workflows/gamma-intraday.yml` | Refresh intradía de régimen |
| `vercel.json` | Crons de Vercel |

## Apéndice B — Glosario

- **GEX**: Gamma Exposure. Dollar-gamma del dealer por 1% de movimiento.
- **VEX**: Vanna Exposure. Sensibilidad del delta del dealer ante cambios de IV.
- **King Node**: strike de mayor |GEX| agregado; imán de precio.
- **Gamma Flip**: nivel de spot donde netGEX cambia de signo (long↔short gamma).
- **Long/Short Gamma**: régimen donde el dealer amortigua (long) o amplifica (short) el movimiento.
- **Dealer Bias**: posicionamiento inferido del cliente (el dealer es su opuesto).
- **Put/Call Wall**: strike de mayor |put_gex| bajo el spot / |call_gex| sobre el spot.
- **Air Pocket**: celda de la matriz con |exposición| < 5% del máximo (baja densidad de gamma).
- **OCC ID**: identificador de contrato `{TICKER}{YYMMDD}{C|P}{strike×1000}`.
```
