import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Activity, Download, Info, Maximize2, Minimize2, X } from 'lucide-react';
import { exportReport, ExportColumn, ExportFormat } from '@/lib/export-report';
import EtfHoldingsTooltip, { EtfHoldingsMap, finvizUrl } from './EtfHoldingsTooltip';

export interface RelativeStrengthReturns {
  fromOpen: number | null;
  day: number | null;
  week: number | null;
  month: number | null;
  ytd: number | null;
  yoy: number | null;
  dist52wHigh: number | null;
}

export interface RelativeStrengthEntry {
  ticker: string;
  name: string;
  price: number;
  score: number | null;
  delta1W: number | null;
  delta1M: number | null;
  rsSpark: number[];
  returns: RelativeStrengthReturns;
  insufficientHistory: boolean;
  isBenchmark?: boolean;
}

export interface RelativeStrengthData {
  asOf: string | null;
  benchmark: string;
  universe: RelativeStrengthEntry[];
}

interface RelativeStrengthPanelProps {
  data: RelativeStrengthData | null;
  loading: boolean;
  etfHoldings: EtfHoldingsMap;
}

type SortKey = 'ticker' | 'score' | 'delta1W' | 'delta1M';
type SortDir = 'asc' | 'desc';
type ResumenSortKey = 'ticker' | 'score' | 'fromOpen' | 'day' | 'week' | 'month' | 'ytd' | 'yoy' | 'dist52wHigh';

function rankSortValue(u: RelativeStrengthEntry, key: SortKey): string | number {
  switch (key) {
    case 'ticker': return u.ticker;
    case 'score': return u.score ?? -Infinity;
    case 'delta1W': return u.delta1W ?? -Infinity;
    case 'delta1M': return u.delta1M ?? -Infinity;
  }
}

function resumenSortValue(u: RelativeStrengthEntry, key: ResumenSortKey): string | number {
  switch (key) {
    case 'ticker': return u.ticker;
    case 'score': return u.score ?? -Infinity;
    case 'fromOpen': return u.returns.fromOpen ?? -Infinity;
    case 'day': return u.returns.day ?? -Infinity;
    case 'week': return u.returns.week ?? -Infinity;
    case 'month': return u.returns.month ?? -Infinity;
    case 'ytd': return u.returns.ytd ?? -Infinity;
    case 'yoy': return u.returns.yoy ?? -Infinity;
    case 'dist52wHigh': return u.returns.dist52wHigh ?? -Infinity;
  }
}

// Diverging red/green over this dashboard's existing dark surfaces - kept
// identical to the hex pair every other panel already uses (FundFlowPanel,
// InstitutionalFlowScorePanel) rather than adopting a new palette for just
// this one panel. Checked against the dataviz skill's validator
// (validate_palette.js "#ff2a6d,#6b7280,#00e676" --mode dark): it FAILs the
// categorical checks (chroma floor on the neutral midpoint, CVD separation
// near it) but that validator is scoped to categorical/identity palettes -
// this is a diverging MAGNITUDE encoding (background tint behind a number),
// not series identity, and the skill's actual hard requirement for that case
// - the numeric value always rendered as visible text, never color alone -
// is honored on every cell below.
const RED: [number, number, number] = [255, 42, 109];
const GREEN: [number, number, number] = [0, 230, 118];

function divergingBg(value: number | null, maxAbs: number, alphaMax = 0.32): string {
  if (value == null || maxAbs === 0) return 'transparent';
  const t = Math.max(-1, Math.min(1, value / maxAbs));
  const c = t >= 0 ? GREEN : RED;
  const alpha = Math.abs(t) * alphaMax;
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha.toFixed(3)})`;
}

// Sequential single-hue ramp (magnitude only, always <= 0) for distance to
// the 52-week high - not a polarity, so no green pole.
function sequentialRedBg(value: number | null, cap = 0.3, alphaMax = 0.4): string {
  if (value == null) return 'transparent';
  const t = Math.min(1, Math.abs(value) / cap);
  const alpha = t * alphaMax;
  return `rgba(${RED[0]},${RED[1]},${RED[2]},${alpha.toFixed(3)})`;
}

function scoreBg(score: number | null): string {
  if (score == null) return 'transparent';
  return divergingBg((score - 0.5) * 2, 1, 0.35);
}

function formatPct(v: number | null, digits = 2): string {
  if (v == null || Number.isNaN(v)) return 'ND';
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(digits)}%`;
}

function formatPp(v: number | null): string {
  if (v == null || Number.isNaN(v)) return 'ND';
  return `${v >= 0 ? '+' : ''}${v.toFixed(0)} pps`;
}

function pctColor(v: number | null): string {
  if (v == null) return 'rgba(255,255,255,0.3)';
  return v >= 0 ? '#00e676' : '#ff2a6d';
}

function resumenSortArrow(key: ResumenSortKey, activeKey: ResumenSortKey | null, dir: SortDir): string {
  if (key !== activeKey) return '';
  return dir === 'desc' ? ' ▼' : ' ▲';
}

type Heat = 'positive' | 'negative' | 'neutral' | null;

function heatSigned(v: number | null): Heat {
  if (v == null) return null;
  if (v > 0) return 'positive';
  if (v < 0) return 'negative';
  return 'neutral';
}

function heatScore(score: number | null): Heat {
  if (score == null) return null;
  if (score > 0.5) return 'positive';
  if (score < 0.5) return 'negative';
  return 'neutral';
}

const SPARK_PNG_WIDTH = 180;
const SPARK_PNG_HEIGHT = 56;

// Renders the same sparkline shown on screen (bar or line, per the panel's
// shared toggle) to a PNG data URL via <canvas>, so the exported report can
// embed the exact chart the user is looking at - SVG can't be embedded
// directly into jsPDF/exceljs, but a rasterized copy can.
function renderSparklinePng(values: number[], chartType: SparkChartType): string | null {
  if (typeof document === 'undefined' || values.length < 2) return null;
  const width = SPARK_PNG_WIDTH;
  const height = SPARK_PNG_HEIGHT;
  const dpr = 2;
  const canvas = document.createElement('canvas');
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(dpr, dpr);

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const rising = values[values.length - 1] >= values[0];
  const color = rising ? '#00e676' : '#ff2a6d';

  if (chartType === 'bar') {
    const colWidth = width / values.length;
    const barWidth = Math.max(1, colWidth - 1.5);
    ctx.fillStyle = color;
    values.forEach((v, i) => {
      const normalized = (v - min) / range;
      const barHeight = Math.max(1, normalized * height);
      ctx.fillRect(i * colWidth, height - barHeight, barWidth, barHeight);
    });
  } else {
    const stepX = width / (values.length - 1);
    const linePoints = values.map((v, i) => [i * stepX, height - ((v - min) / range) * height]);

    ctx.beginPath();
    ctx.moveTo(0, height);
    linePoints.forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.beginPath();
    linePoints.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  return canvas.toDataURL('image/png');
}

// Column definitions for the two export reports - mirrors what each section
// shows on screen (same formatPct output), so the exported file reads the
// same as the panel rather than needing its own interpretation. Ranking's
// columns are a function of the current sparkline chart type (bar/line) so
// the exported "Gráfico" column matches whatever the on-screen toggle shows.
function getRankingExportColumns(chartType: SparkChartType): ExportColumn<RelativeStrengthEntry>[] {
  return [
    { header: 'Ticker', value: u => u.ticker },
    { header: 'Nombre', value: u => u.name },
    { header: 'Gráfico', value: () => '', image: u => renderSparklinePng(u.rsSpark, chartType) },
    { header: 'Score', value: u => (u.score == null ? 'ND' : `${(u.score * 100).toFixed(0)}%`), heat: u => heatScore(u.score) },
    { header: 'Δ1W (pps)', value: u => formatPp(u.delta1W), heat: u => heatSigned(u.delta1W) },
    { header: 'Δ1M (pps)', value: u => formatPp(u.delta1M), heat: u => heatSigned(u.delta1M) },
    { header: 'RS Actual', value: u => (u.rsSpark.length > 0 ? u.rsSpark[u.rsSpark.length - 1].toFixed(4) : 'ND') },
    { header: 'Precio', value: u => u.price.toFixed(2) }
  ];
}

const RESUMEN_EXPORT_COLUMNS: ExportColumn<RelativeStrengthEntry>[] = [
  { header: 'Ticker', value: u => u.ticker },
  { header: 'Nombre', value: u => u.name },
  { header: 'Score', value: u => (u.score == null ? 'ND' : `${(u.score * 100).toFixed(0)}%`), heat: u => heatScore(u.score) },
  { header: 'From Open', value: u => formatPct(u.returns.fromOpen), heat: u => heatSigned(u.returns.fromOpen) },
  { header: 'Día', value: u => formatPct(u.returns.day), heat: u => heatSigned(u.returns.day) },
  { header: 'Semana', value: u => formatPct(u.returns.week), heat: u => heatSigned(u.returns.week) },
  { header: 'Mes', value: u => formatPct(u.returns.month), heat: u => heatSigned(u.returns.month) },
  { header: 'YTD', value: u => formatPct(u.returns.ytd), heat: u => heatSigned(u.returns.ytd) },
  { header: 'YoY', value: u => formatPct(u.returns.yoy), heat: u => heatSigned(u.returns.yoy) },
  { header: '52W High', value: u => formatPct(u.returns.dist52wHigh), heat: u => heatSigned(u.returns.dist52wHigh) }
];

// Compact min-max normalized line sparkline for the RS ratio series - not
// MetricBars (that component draws bidirectional bars from a center
// baseline, built for signed net-flow values; an RS ratio has no meaningful
// zero-crossing, it's a continuous series around ~1.0).
type SparkChartType = 'line' | 'bar';

function RsSparkline({ values, width = 90, height = 28, chartType = 'line' }: { values: number[]; width?: number; height?: number; chartType?: SparkChartType }) {
  if (values.length < 2) {
    return <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)' }}>—</span>;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const rising = values[values.length - 1] >= values[0];
  const color = rising ? '#00e676' : '#ff2a6d';

  if (chartType === 'bar') {
    const colWidth = width / values.length;
    const barWidth = Math.max(1, colWidth - 1.5);
    return (
      <svg width={width} height={height} style={{ display: 'block', flexShrink: 0, overflow: 'visible' }}>
        {values.map((v, i) => {
          const normalized = (v - min) / range;
          const barHeight = Math.max(1, normalized * height);
          return (
            <rect
              key={i}
              x={i * colWidth}
              y={height - barHeight}
              width={barWidth}
              height={barHeight}
              fill={color}
              opacity={0.85}
            />
          );
        })}
      </svg>
    );
  }

  const stepX = width / (values.length - 1);
  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const areaPoints = `0,${height} ${points.join(' ')} ${width},${height}`;

  return (
    <svg width={width} height={height} style={{ display: 'block', flexShrink: 0, overflow: 'visible' }}>
      <polygon points={areaPoints} fill={color} fillOpacity={0.12} stroke="none" />
      <polyline points={points.join(' ')} fill="none" stroke={color} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// Small "Export ▾" dropdown (PDF/CSV/XLSX), same click-outside-to-close
// pattern as NotificationBell/FundFlowAlertsBell's dropdowns elsewhere in
// this dashboard. `onExport` does the actual work (see exportReport in
// src/lib/export-report.ts) - this component only owns the open/closed and
// in-flight UI state.
function ExportMenu({ onExport }: { onExport: (format: ExportFormat) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handlePick = async (format: ExportFormat) => {
    setExporting(format);
    try {
      await onExport(format);
    } finally {
      setExporting(null);
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={exportButtonStyle} aria-label="Exportar">
        <Download size={12} />
        <span>Exportar</span>
      </button>
      {open && (
        <div style={exportDropdownStyle}>
          {(['pdf', 'csv', 'xlsx'] as ExportFormat[]).map(format => (
            <button
              key={format}
              onClick={() => handlePick(format)}
              disabled={exporting != null}
              style={exportOptionStyle}
            >
              {exporting === format ? 'Generando…' : format.toUpperCase()}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RelativeStrengthInfoModal({ onClose }: { onClose: () => void }) {
  return createPortal(
    <div style={infoOverlayStyle} onClick={onClose}>
      <div style={infoModalStyle} onClick={e => e.stopPropagation()}>
        <div style={infoModalHeaderStyle}>
          <span style={{ fontWeight: 800, fontSize: '0.95rem', color: '#a78bfa' }}>¿Cómo leer Fuerza Relativa?</span>
          <button onClick={onClose} style={infoCloseButtonStyle} aria-label="Cerrar"><X size={16} /></button>
        </div>
        <p style={infoTextStyle}>
          Para cada ETF se calcula su fuerza relativa contra SPY día a día (precio del ETF / precio de SPY) y se mide
          en qué percentil está el valor de hoy respecto a sus últimos 25 días (Score). 100% = el más fuerte relativo
          de las últimas ~5 semanas; 0% = el más débil.
        </p>
        <div style={infoSectionStyle}>
          <div style={infoTermStyle}>Δ1W / Δ1M (puntos de percentil)</div>
          <p style={infoTextStyle}>
            Cuánto cambió el Score respecto a hace 1 semana / hace 1 mes — la señal de rotación (RN-12): un score alto
            que además viene subiendo fuerte es más relevante que un score alto y estable. Nota técnica: Δ1M no es una
            ventana de 25 días desplazada un mes completo, sino una ventana de 44 días terminada en el mismo punto que
            Δ1W (hace 4 sesiones) — así está definido en el sistema original que este panel replica, no es un error.
          </p>
        </div>
        <div style={infoSectionStyle}>
          <div style={infoTermStyle}>Resumen Multi-Período</div>
          <p style={infoTextStyle}>
            Cruza el Score con el rendimiento absoluto (From Open, Día, Semana, Mes, YTD, YoY) y la distancia al
            máximo de 52 semanas — confirma si un líder de fuerza relativa también está ganando en precio y cerca de
            sus máximos, la lectura combinada que el sistema original recomienda.
          </p>
        </div>
        <div style={{ ...infoSectionStyle, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '12px' }}>
          <div style={{ ...infoTermStyle, color: '#fff' }}>Adaptación vs. el original</div>
          <p style={infoTextStyle}>
            Esta versión recalcula con el cierre más reciente disponible (no hay feed intradía en vivo todavía), y
            calcula el ranking automáticamente en vez de depender de un ordenado manual.
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function RelativeStrengthPanel({ data, loading, etfHoldings }: RelativeStrengthPanelProps) {
  const [sortBy, setSortBy] = useState<SortKey>('score');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [resumenSortBy, setResumenSortBy] = useState<ResumenSortKey | null>('score');
  const [resumenSortDir, setResumenSortDir] = useState<SortDir>('desc');
  const [showInfo, setShowInfo] = useState(false);
  const [hoveredSpark, setHoveredSpark] = useState<string | null>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);
  // One shared chart type for every sparkline in the list - clicking any of
  // them flips all of them together, rather than each ticker toggling on
  // its own.
  const [sparkChartType, setSparkChartType] = useState<SparkChartType>('bar');

  const toggleSparkChartType = () => {
    setSparkChartType(prev => (prev === 'bar' ? 'line' : 'bar'));
  };

  // Clicking the already-active column flips direction; clicking a new
  // column switches to it defaulting to descending (highest first) for the
  // numeric columns, or ascending (A-Z) for Ticker.
  const handleSort = (key: SortKey) => {
    if (key === sortBy) {
      setSortDir(d => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortBy(key);
      setSortDir(key === 'ticker' ? 'asc' : 'desc');
    }
  };

  // Same toggle behavior as the Ranking columns above, except Ticker
  // defaults to ascending (A-Z) on first click since alphabetical order
  // reads naturally starting from A, unlike the numeric columns where
  // "biggest first" is the more useful default.
  const handleResumenSort = (key: ResumenSortKey) => {
    if (key === resumenSortBy) {
      setResumenSortDir(d => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setResumenSortBy(key);
      setResumenSortDir(key === 'ticker' ? 'asc' : 'desc');
    }
  };

  const sorted = useMemo(() => {
    if (!data) return [];
    const scoreable = data.universe.filter(u => !u.isBenchmark && !u.insufficientHistory);
    const dirMul = sortDir === 'desc' ? -1 : 1;
    return [...scoreable].sort((a, b) => {
      const av = rankSortValue(a, sortBy);
      const bv = rankSortValue(b, sortBy);
      if (typeof av === 'string' || typeof bv === 'string') {
        return String(av).localeCompare(String(bv)) * dirMul;
      }
      return (av - bv) * dirMul;
    });
  }, [data, sortBy, sortDir]);

  const resumenSorted = useMemo(() => {
    if (!data) return [];
    if (!resumenSortBy) return data.universe;
    const dirMul = resumenSortDir === 'desc' ? -1 : 1;
    return [...data.universe].sort((a, b) => {
      const av = resumenSortValue(a, resumenSortBy);
      const bv = resumenSortValue(b, resumenSortBy);
      if (typeof av === 'string' || typeof bv === 'string') {
        return String(av).localeCompare(String(bv)) * dirMul;
      }
      return (av - bv) * dirMul;
    });
  }, [data, resumenSortBy, resumenSortDir]);

  if (loading) {
    return (
      <div style={panelContainerStyle}>
        <div style={topGlowBarStyle} />
        <div style={headerStyle}>
          <Activity size={18} style={{ color: '#a78bfa' }} />
          <h3 style={titleStyle}>FUERZA RELATIVA</h3>
        </div>
        <div style={loadingContainerStyle}>
          <div className="animate-pulse" style={loadingTextStyle}>Cargando fuerza relativa...</div>
        </div>
      </div>
    );
  }

  if (!data || data.universe.length === 0) {
    return (
      <div style={panelContainerStyle}>
        <div style={topGlowBarStyle} />
        <div style={headerStyle}>
          <Activity size={18} style={{ color: '#a78bfa' }} />
          <h3 style={titleStyle}>FUERZA RELATIVA</h3>
        </div>
        <div style={errorContainerStyle}>
          <div style={errorTitleStyle}>Sin datos todavía</div>
          <div style={errorDescStyle}>
            Este panel se completa con la primera corrida de <code>npm run rs:daily</code>.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={isFullScreen ? { ...panelContainerStyle, position: 'fixed', top: '20px', left: '20px', right: '20px', bottom: '20px', zIndex: 9999, height: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.8)' } : panelContainerStyle}>
      <div style={topGlowBarStyle} />
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Activity size={18} style={{ color: '#a78bfa' }} />
          <h3 style={titleStyle}>FUERZA RELATIVA</h3>
          <button onClick={() => setShowInfo(true)} style={infoButtonStyle} aria-label="¿Cómo leer este panel?">
            <Info size={12} />
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {data.asOf && (
            <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)' }}>
              vs {data.benchmark} · al {data.asOf}
            </span>
          )}
          <button
            onClick={() => setIsFullScreen(v => !v)}
            style={maximizeButtonStyle}
            aria-label={isFullScreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
            title={isFullScreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
          >
            {isFullScreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>
      </div>
      {showInfo && <RelativeStrengthInfoModal onClose={() => setShowInfo(false)} />}

      <div style={gridStyle}>
        {/* Section A - Ranking / Rotación */}
        <div style={sectionColStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <h4 style={colHeaderStyle}>RANKING / ROTACIÓN</h4>
            <ExportMenu
              onExport={format => exportReport(
                format,
                `fuerza-relativa-ranking-${data.asOf ?? 'sin-fecha'}`,
                'Fuerza Relativa — Ranking / Rotación',
                `vs ${data.benchmark} · al ${data.asOf ?? 'N/D'}`,
                getRankingExportColumns(sparkChartType),
                sorted
              )}
            />
          </div>
          {/* Column headers, sharing rankRowStyle's exact flex widths/gap so
              Score/Δ1W/Δ1M sit directly above their data columns instead of
              floating in the panel header above the ticker/sparkline
              columns - the sort buttons double as these headers. */}
          <div style={{ ...rankRowStyle, padding: '0 6px 4px' }}>
            <button
              onClick={() => handleSort('ticker')}
              style={{ ...columnSortButtonStyle, flex: '0 0 100px', textAlign: 'left', ...(sortBy === 'ticker' ? sortButtonActiveStyle : {}) }}
            >
              Ticker{sortBy === 'ticker' ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ''}
            </button>
            <span style={{ width: '90px', flexShrink: 0 }} />
            <button
              onClick={() => handleSort('score')}
              style={{ ...columnSortButtonStyle, ...heatChipStyle, ...(sortBy === 'score' ? sortButtonActiveStyle : {}) }}
            >
              Score{sortBy === 'score' ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ''}
            </button>
            <button
              onClick={() => handleSort('delta1W')}
              style={{ ...columnSortButtonStyle, ...deltaChipStyle, ...(sortBy === 'delta1W' ? sortButtonActiveStyle : {}) }}
            >
              Δ1W{sortBy === 'delta1W' ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ''}
            </button>
            <button
              onClick={() => handleSort('delta1M')}
              style={{ ...columnSortButtonStyle, ...deltaChipStyle, ...(sortBy === 'delta1M' ? sortButtonActiveStyle : {}) }}
            >
              Δ1M{sortBy === 'delta1M' ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ''}
            </button>
          </div>
          <div style={{ ...scrollColStyle, display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {sorted.map((u, idx) => (
            <div key={u.ticker} style={rankRowStyle}>
              <span style={{ ...sectorTickerStyle, flex: '0 0 100px' }}>
                <EtfHoldingsTooltip ticker={u.ticker} holdingsMap={etfHoldings}>
                  <a href={finvizUrl(u.ticker)} target="_blank" rel="noopener noreferrer" style={tickerLinkStyle}>{u.ticker}</a>
                </EtfHoldingsTooltip>
                <span style={sectorLabelStyle}>{u.name}</span>
              </span>
              <span
                onMouseEnter={() => setHoveredSpark(u.ticker)}
                onMouseLeave={() => setHoveredSpark(null)}
                onClick={toggleSparkChartType}
                style={{ position: 'relative', cursor: 'pointer' }}
                title="Click para alternar línea / barras (todos los gráficos)"
              >
                <RsSparkline values={u.rsSpark} chartType={sparkChartType} />
                {hoveredSpark === u.ticker && (
                  // First row has no room above it inside the scrolling list
                  // (scrollColStyle's overflow:auto clips anything that pokes
                  // out past its own top edge) - drop the tooltip below the
                  // sparkline there instead of above, same as every other row.
                  <div style={idx === 0 ? sparkTooltipBelowStyle : sparkTooltipStyle}>
                    {u.rsSpark.length} sesiones · último RS {u.rsSpark[u.rsSpark.length - 1]?.toFixed(4)}
                  </div>
                )}
              </span>
              <span style={{ ...heatChipStyle, backgroundColor: scoreBg(u.score) }}>
                {u.score == null ? 'ND' : `${(u.score * 100).toFixed(0)}%`}
              </span>
              <span style={{ ...deltaChipStyle, color: pctColor(u.delta1W) }}>{formatPp(u.delta1W)}</span>
              <span style={{ ...deltaChipStyle, color: pctColor(u.delta1M) }}>{formatPp(u.delta1M)}</span>
            </div>
          ))}
          </div>
        </div>

        {/* Section B - Resumen Multi-Período */}
        <div style={sectionColStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <h4 style={colHeaderStyle}>RESUMEN MULTI-PERÍODO</h4>
            <ExportMenu
              onExport={format => exportReport(
                format,
                `fuerza-relativa-resumen-${data.asOf ?? 'sin-fecha'}`,
                'Fuerza Relativa — Resumen Multi-Período',
                `vs ${data.benchmark} · al ${data.asOf ?? 'N/D'}`,
                RESUMEN_EXPORT_COLUMNS,
                resumenSorted
              )}
            />
          </div>
          <div style={{ ...scrollColStyle, border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={{ ...thStyle, textAlign: 'left', position: 'sticky', left: 0, zIndex: 2, padding: 0 }}>
                  <button onClick={() => handleResumenSort('ticker')} style={{ ...sortableThStyle, textAlign: 'left', ...(resumenSortBy === 'ticker' ? sortableThActiveStyle : {}) }}>
                    Ticker{resumenSortArrow('ticker', resumenSortBy, resumenSortDir)}
                  </button>
                </th>
                <th style={{ ...thStyle, padding: 0 }}>
                  <button onClick={() => handleResumenSort('score')} style={{ ...sortableThStyle, ...(resumenSortBy === 'score' ? sortableThActiveStyle : {}) }}>
                    Score{resumenSortArrow('score', resumenSortBy, resumenSortDir)}
                  </button>
                </th>
                <th style={{ ...thStyle, padding: 0 }}>
                  <button onClick={() => handleResumenSort('fromOpen')} style={{ ...sortableThStyle, ...(resumenSortBy === 'fromOpen' ? sortableThActiveStyle : {}) }}>
                    From Open{resumenSortArrow('fromOpen', resumenSortBy, resumenSortDir)}
                  </button>
                </th>
                <th style={{ ...thStyle, padding: 0 }}>
                  <button onClick={() => handleResumenSort('day')} style={{ ...sortableThStyle, ...(resumenSortBy === 'day' ? sortableThActiveStyle : {}) }}>
                    Día{resumenSortArrow('day', resumenSortBy, resumenSortDir)}
                  </button>
                </th>
                <th style={{ ...thStyle, padding: 0 }}>
                  <button onClick={() => handleResumenSort('week')} style={{ ...sortableThStyle, ...(resumenSortBy === 'week' ? sortableThActiveStyle : {}) }}>
                    Semana{resumenSortArrow('week', resumenSortBy, resumenSortDir)}
                  </button>
                </th>
                <th style={{ ...thStyle, padding: 0 }}>
                  <button onClick={() => handleResumenSort('month')} style={{ ...sortableThStyle, ...(resumenSortBy === 'month' ? sortableThActiveStyle : {}) }}>
                    Mes{resumenSortArrow('month', resumenSortBy, resumenSortDir)}
                  </button>
                </th>
                <th style={{ ...thStyle, padding: 0 }}>
                  <button onClick={() => handleResumenSort('ytd')} style={{ ...sortableThStyle, ...(resumenSortBy === 'ytd' ? sortableThActiveStyle : {}) }}>
                    YTD{resumenSortArrow('ytd', resumenSortBy, resumenSortDir)}
                  </button>
                </th>
                <th style={{ ...thStyle, padding: 0 }}>
                  <button onClick={() => handleResumenSort('yoy')} style={{ ...sortableThStyle, ...(resumenSortBy === 'yoy' ? sortableThActiveStyle : {}) }}>
                    YoY{resumenSortArrow('yoy', resumenSortBy, resumenSortDir)}
                  </button>
                </th>
                <th style={{ ...thStyle, padding: 0 }}>
                  <button onClick={() => handleResumenSort('dist52wHigh')} style={{ ...sortableThStyle, ...(resumenSortBy === 'dist52wHigh' ? sortableThActiveStyle : {}) }}>
                    52W High{resumenSortArrow('dist52wHigh', resumenSortBy, resumenSortDir)}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {resumenSorted.map(u => (
                <tr key={u.ticker}>
                  <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 700, position: 'sticky', left: 0, background: 'rgba(10,16,35,0.95)' }}>
                    <EtfHoldingsTooltip ticker={u.ticker} holdingsMap={etfHoldings}>
                      <a href={finvizUrl(u.ticker)} target="_blank" rel="noopener noreferrer" style={tickerLinkStyle}>{u.ticker}</a>
                    </EtfHoldingsTooltip>
                    <span style={sectorLabelStyle}> {u.name}</span>
                  </td>
                  <td style={{ ...tdStyle, backgroundColor: scoreBg(u.score) }}>{u.score == null ? 'ND' : `${(u.score * 100).toFixed(0)}%`}</td>
                  <td style={{ ...tdStyle, backgroundColor: divergingBg(u.returns.fromOpen, 0.03) }}>{formatPct(u.returns.fromOpen)}</td>
                  <td style={{ ...tdStyle, backgroundColor: divergingBg(u.returns.day, 0.05) }}>{formatPct(u.returns.day)}</td>
                  <td style={{ ...tdStyle, backgroundColor: divergingBg(u.returns.week, 0.08) }}>{formatPct(u.returns.week)}</td>
                  <td style={{ ...tdStyle, backgroundColor: divergingBg(u.returns.month, 0.15) }}>{formatPct(u.returns.month)}</td>
                  <td style={{ ...tdStyle, backgroundColor: divergingBg(u.returns.ytd, 0.5) }}>{formatPct(u.returns.ytd)}</td>
                  <td style={{ ...tdStyle, backgroundColor: divergingBg(u.returns.yoy, 0.5) }}>{formatPct(u.returns.yoy)}</td>
                  <td style={{ ...tdStyle, backgroundColor: sequentialRedBg(u.returns.dist52wHigh) }}>{formatPct(u.returns.dist52wHigh)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      </div>
    </div>
  );
}

const panelContainerStyle: React.CSSProperties = {
  backgroundColor: 'rgba(13, 20, 38, 0.75)',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'rgba(255, 255, 255, 0.08)',
  borderRadius: '14px',
  padding: '16px',
  display: 'flex',
  flexDirection: 'column',
  gap: '14px',
  backdropFilter: 'blur(16px)',
  boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.36)',
  color: '#fff',
  margin: '0 0 1rem 0',
  boxSizing: 'border-box',
  position: 'relative',
  overflow: 'hidden'
};

const topGlowBarStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  height: '2px',
  background: 'linear-gradient(90deg, transparent, rgba(167, 139, 250, 0.6), transparent)',
  pointerEvents: 'none',
  zIndex: 10
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
  paddingBottom: '8px'
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '1rem',
  fontWeight: 800,
  letterSpacing: '0.05em',
  color: '#a78bfa'
};

// Ranking (compact list) and Resumen (wide multi-column table) side by side,
// sharing the panel's full width - same idea as FundFlowPanel's Sector Flow
// | COT grid, sized for their different natural content widths.
const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(320px, 460px) minmax(480px, 1fr)',
  gap: '24px',
  alignItems: 'stretch'
};

// `minHeight: 0` overrides the grid item's default `min-height: auto`,
// which otherwise stops the scrollable child below from ever shrinking below
// its content height inside a grid track - the classic grid/flexbox overflow
// gotcha that would silently defeat scrollColStyle's maxHeight.
const sectionColStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0
};

// Sized to the viewport rather than a fixed pixel value, so both columns use
// as much vertical space as the screen actually has instead of an arbitrary
// small crop - maximizes how many rows are visible without scrolling.
const scrollColStyle: React.CSSProperties = {
  maxHeight: 'calc(100vh - 220px)',
  minHeight: '400px',
  overflow: 'auto'
};

const colHeaderStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.75rem',
  fontWeight: 800,
  color: 'rgba(255,255,255,0.4)',
  letterSpacing: '0.08em'
};

const rankRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  fontSize: '0.8rem',
  padding: '4px 6px',
  borderRadius: '6px'
};

const sectorTickerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  fontWeight: 700
};

const tickerLinkStyle: React.CSSProperties = {
  color: 'inherit',
  textDecoration: 'none'
};

const sectorLabelStyle: React.CSSProperties = {
  fontWeight: 400,
  fontSize: '0.68rem',
  color: 'rgba(255,255,255,0.4)'
};

const heatChipStyle: React.CSSProperties = {
  flex: '0 0 52px',
  textAlign: 'center',
  fontFamily: 'monospace',
  fontWeight: 700,
  fontSize: '0.75rem',
  padding: '3px 0',
  borderRadius: '5px'
};

const deltaChipStyle: React.CSSProperties = {
  flex: '0 0 68px',
  textAlign: 'right',
  fontFamily: 'monospace',
  fontWeight: 700,
  fontSize: '0.7rem'
};

const exportButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  fontSize: '0.65rem',
  fontWeight: 700,
  padding: '3px 8px',
  borderRadius: '6px',
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.04)',
  color: 'rgba(255,255,255,0.6)',
  cursor: 'pointer'
};

const exportDropdownStyle: React.CSSProperties = {
  position: 'absolute',
  top: '28px',
  right: 0,
  display: 'flex',
  flexDirection: 'column',
  width: '110px',
  backgroundColor: 'rgba(10, 16, 35, 0.98)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '8px',
  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  overflow: 'hidden',
  zIndex: 30
};

const exportOptionStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: '0.7rem',
  fontWeight: 700,
  textAlign: 'left',
  background: 'transparent',
  border: 'none',
  borderBottom: '1px solid rgba(255,255,255,0.05)',
  color: 'rgba(255,255,255,0.75)',
  cursor: 'pointer'
};

// Column headers that double as sort-toggle buttons (Score/Δ1W/Δ1M above
// the Ranking rows) - deliberately no border/background/padding of their
// own so they read as plain header labels; heatChipStyle/deltaChipStyle
// (spread after this) supply the actual alignment that has to match the
// data cells exactly, and sortButtonActiveStyle (spread last, active state
// only) adds the pill treatment so the active sort column is obvious.
const columnSortButtonStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'rgba(255,255,255,0.4)',
  cursor: 'pointer',
  letterSpacing: '0.02em'
};

const sortButtonActiveStyle: React.CSSProperties = {
  background: 'rgba(167,139,250,0.15)',
  border: '1px solid rgba(167,139,250,0.4)',
  color: '#a78bfa'
};

const sparkTooltipStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: '100%',
  left: '50%',
  transform: 'translateX(-50%)',
  marginBottom: '6px',
  backgroundColor: 'rgba(10, 16, 35, 0.97)',
  border: '1px solid #a78bfa',
  borderRadius: '6px',
  padding: '4px 8px',
  fontSize: '0.65rem',
  whiteSpace: 'nowrap',
  color: 'rgba(255,255,255,0.8)',
  zIndex: 20,
  pointerEvents: 'none'
};

// Same tooltip, flipped to sit below the sparkline instead of above - used
// for the first row only, see the comment at its call site.
const sparkTooltipBelowStyle: React.CSSProperties = {
  ...sparkTooltipStyle,
  bottom: 'auto',
  top: '100%',
  marginBottom: 0,
  marginTop: '6px'
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.72rem',
  fontFamily: 'monospace'
};

const thStyle: React.CSSProperties = {
  padding: '8px 10px',
  textAlign: 'right',
  fontFamily: 'inherit',
  fontWeight: 700,
  color: 'rgba(255,255,255,0.5)',
  borderBottom: '1px solid rgba(255,255,255,0.1)',
  position: 'sticky',
  top: 0,
  background: 'rgba(10,16,35,0.95)',
  zIndex: 1
};

// th children rendered as buttons so every Resumen column header doubles as
// a sort toggle, same pattern as columnSortButtonStyle above the Ranking
// list - thStyle's padding moves onto this button (its own padding is
// zeroed) so the clickable area still matches the original cell exactly.
const sortableThStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '8px 10px',
  textAlign: 'right',
  border: 'none',
  background: 'transparent',
  fontFamily: 'inherit',
  fontWeight: 700,
  fontSize: 'inherit',
  color: 'rgba(255,255,255,0.5)',
  whiteSpace: 'nowrap',
  cursor: 'pointer'
};

const sortableThActiveStyle: React.CSSProperties = {
  color: '#a78bfa'
};

const tdStyle: React.CSSProperties = {
  padding: '5px 10px',
  textAlign: 'right',
  borderBottom: '1px solid rgba(255,255,255,0.04)',
  whiteSpace: 'nowrap'
};

const loadingContainerStyle: React.CSSProperties = {
  height: '100px',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center'
};

const loadingTextStyle: React.CSSProperties = {
  fontSize: '0.875rem',
  color: 'rgba(255,255,255,0.4)'
};

const errorContainerStyle: React.CSSProperties = {
  padding: '20px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  gap: '10px'
};

const errorTitleStyle: React.CSSProperties = {
  fontSize: '0.95rem',
  fontWeight: 700,
  color: 'rgba(255,255,255,0.8)'
};

const errorDescStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  color: 'rgba(255,255,255,0.4)',
  lineHeight: 1.6
};

const maximizeButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: '6px',
  color: 'rgba(255,255,255,0.6)',
  width: '22px',
  height: '22px',
  padding: 0,
  cursor: 'pointer'
};

const infoButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: '50%',
  color: 'rgba(255,255,255,0.5)',
  cursor: 'pointer',
  width: '18px',
  height: '18px',
  padding: 0
};

const infoOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  padding: '20px'
};

const infoModalStyle: React.CSSProperties = {
  backgroundColor: '#0a1023',
  border: '1px solid rgba(167,139,250,0.3)',
  borderRadius: '14px',
  padding: '22px',
  width: '480px',
  maxWidth: '100%',
  maxHeight: '85vh',
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: '14px',
  boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
  color: '#fff'
};

const infoModalHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between'
};

const infoCloseButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '6px',
  color: 'rgba(255,255,255,0.7)',
  cursor: 'pointer',
  width: '26px',
  height: '26px',
  padding: 0
};

const infoSectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px'
};

const infoTermStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  fontWeight: 800,
  color: '#a78bfa'
};

const infoTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.78rem',
  lineHeight: 1.6,
  color: 'rgba(255,255,255,0.75)'
};
