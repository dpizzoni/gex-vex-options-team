import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Droplets, AlertCircle, Info, X } from 'lucide-react';

export interface FedLiquidityEntry {
  date: string;
  walcl: number;
  tga: number;
  rrp: number;
  net_liquidity: number;
}

interface MacroLiquidityPanelProps {
  history: FedLiquidityEntry[];
  loading: boolean;
}

function formatBillions(val: number | null | undefined): string {
  if (val === null || val === undefined || Number.isNaN(val)) return 'N/D';
  const sign = val < 0 ? '-' : '';
  const abs = Math.abs(val);
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(2)}T`;
  return `${sign}$${abs.toFixed(1)}B`;
}

function formatDelta(val: number | null | undefined): string {
  if (val === null || val === undefined || Number.isNaN(val)) return 'N/D';
  const sign = val >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(val).toFixed(1)}B`;
}

// Latest row vs the closest row ~7 calendar days back - a simple week-over-
// week delta, same cadence the Fed itself updates WALCL/TGA on.
function weekAgoEntry(history: FedLiquidityEntry[]): FedLiquidityEntry | null {
  if (history.length === 0) return null;
  const latest = history[history.length - 1];
  const latestDate = new Date(latest.date).getTime();
  const targetDate = latestDate - 7 * 24 * 60 * 60 * 1000;
  let best: FedLiquidityEntry | null = null;
  for (let i = history.length - 1; i >= 0; i--) {
    const d = new Date(history[i].date).getTime();
    if (d <= targetDate) {
      best = history[i];
      break;
    }
  }
  return best;
}

const SINGLE_CHART_HEIGHT = 70;
const CHART_WIDTH_PERCENT = 100;

type LiquiditySeriesKey = 'walcl' | 'tga' | 'rrp' | 'net_liquidity';

const LIQUIDITY_SERIES: { key: LiquiditySeriesKey; label: string; color: string }[] = [
  { key: 'net_liquidity', label: 'Net Liquidity', color: '#a78bfa' },
  { key: 'walcl', label: 'Fed Balance (WALCL)', color: '#00e676' },
  { key: 'tga', label: 'TGA', color: '#f59e0b' },
  { key: 'rrp', label: 'RRP', color: '#22d3ee' }
];

// One mini-chart per metric, each on its own min/max scale (nominal $
// values, no normalization) - overlaying all four on a shared scale made
// RRP/TGA invisible next to WALCL's trillions, and normalizing to 0-100%
// hid the real shape of small day-to-day moves. Stacking separately trades
// direct overlay-comparison for readable per-metric detail.
function SingleMetricChart({ label, color, data, formatValue, chartId }: {
  label: string;
  color: string;
  data: { date: string; value: number }[];
  formatValue: (v: number) => string;
  chartId: string;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (data.length < 2) {
    return <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.3)' }}>Historial insuficiente para graficar.</span>;
  }

  const width = 600;
  const values = data.map(d => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, Math.abs(max || 1) * 1e-6);

  const points = data.map((d, i) => ({
    x: (i / (data.length - 1)) * width,
    y: SINGLE_CHART_HEIGHT - ((d.value - min) / range) * (SINGLE_CHART_HEIGHT - 6) - 3,
    date: d.date,
    value: d.value
  }));

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
  const areaPath = `${path} L ${width} ${SINGLE_CHART_HEIGHT} L 0 ${SINGLE_CHART_HEIGHT} Z`;
  const slotWidth = width / data.length;
  const hovered = hoveredIndex !== null ? points[hoveredIndex] : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: color, display: 'inline-block', boxShadow: `0 0 6px ${color}` }} />
          <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#e2e8f0', letterSpacing: '0.03em' }}>{label}</span>
        </div>
        <span style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>
          {formatValue(min)} — {formatValue(max)}
        </span>
      </div>
      <div style={{ position: 'relative', width: `${CHART_WIDTH_PERCENT}%`, backgroundColor: 'rgba(0,0,0,0.15)', borderRadius: '6px', padding: '4px', border: '1px solid rgba(255,255,255,0.03)' }}>
        <svg
          width="100%"
          height={SINGLE_CHART_HEIGHT + 4}
          viewBox={`0 0 ${width} ${SINGLE_CHART_HEIGHT + 4}`}
          preserveAspectRatio="none"
          style={{ display: 'block', overflow: 'visible' }}
        >
          <defs>
            <linearGradient id={`grad-${chartId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0.0} />
            </linearGradient>
          </defs>
          <line x1={0} x2={width} y1={SINGLE_CHART_HEIGHT / 2} y2={SINGLE_CHART_HEIGHT / 2} stroke="rgba(255,255,255,0.04)" strokeDasharray="3,3" strokeWidth={1} />
          <line x1={0} x2={width} y1={SINGLE_CHART_HEIGHT} y2={SINGLE_CHART_HEIGHT} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />

          <path d={areaPath} fill={`url(#grad-${chartId})`} />
          <path d={path} fill="none" stroke={color} strokeWidth={2} style={{ filter: `drop-shadow(0 2px 4px ${color}40)` }} />

          {points.map((p, i) => (
            <rect
              key={p.date}
              x={i * slotWidth}
              y={0}
              width={slotWidth}
              height={SINGLE_CHART_HEIGHT}
              fill="transparent"
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
              style={{ cursor: 'pointer' }}
            />
          ))}

          {hovered && (
            <>
              <line x1={hovered.x} x2={hovered.x} y1={0} y2={SINGLE_CHART_HEIGHT} stroke="rgba(255,255,255,0.3)" strokeDasharray="2,2" />
              <circle cx={hovered.x} cy={hovered.y} r={3.5} fill={color} stroke="#0b1021" strokeWidth={1.5} />
            </>
          )}
        </svg>

        {hovered && (
          <div
            style={{
              position: 'absolute',
              left: `${(hovered.x / width) * 100}%`,
              top: 0,
              transform: 'translate(-50%, calc(-100% - 6px))',
              pointerEvents: 'none',
              display: 'flex',
              justifyContent: 'center',
              zIndex: 20
            }}
          >
            <div style={{
              backgroundColor: 'rgba(10, 16, 35, 0.96)',
              border: `1px solid ${color}`,
              borderRadius: '6px',
              padding: '4px 8px',
              fontFamily: 'monospace',
              fontSize: '10px',
              lineHeight: 1.4,
              width: 'max-content',
              boxShadow: '0 4px 14px rgba(0,0,0,0.6)'
            }}>
              <div style={{ color: 'rgba(255,255,255,0.6)' }}>{hovered.date}</div>
              <div style={{ color, fontWeight: 700 }}>{formatValue(hovered.value)}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function LiquidityChartsStack({ history }: { history: FedLiquidityEntry[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {LIQUIDITY_SERIES.map(s => (
        <SingleMetricChart
          key={s.key}
          chartId={s.key}
          label={s.label}
          color={s.color}
          data={history.map(h => ({ date: h.date, value: h[s.key] }))}
          formatValue={formatBillions}
        />
      ))}
    </div>
  );
}

function LiquidityInfoModal({ onClose }: { onClose: () => void }) {
  return createPortal(
    <div style={infoOverlayStyle} onClick={onClose}>
      <div style={infoModalStyle} onClick={e => e.stopPropagation()}>
        <div style={infoModalHeaderStyle}>
          <span style={{ fontWeight: 800, fontSize: '0.95rem', color: '#a78bfa' }}>¿Qué es la liquidez de la Fed?</span>
          <button onClick={onClose} style={infoCloseButtonStyle} aria-label="Cerrar"><X size={16} /></button>
        </div>

        <div style={infoSectionStyle}>
          <div style={{ ...infoTermStyle, color: '#00e676' }}>Fed Balance (WALCL)</div>
          <p style={infoTextStyle}>
            El tamaño total del balance de la Reserva Federal — todos los activos que compró (bonos del Tesoro,
            MBS) mediante QE/QT. Sube cuando la Fed inyecta dinero al sistema comprando activos; baja cuando los
            deja vencer sin reinvertir (QT). Es la fuente bruta de liquidez.
          </p>
        </div>

        <div style={infoSectionStyle}>
          <div style={{ ...infoTermStyle, color: '#f59e0b' }}>Treasury General Account (TGA)</div>
          <p style={infoTextStyle}>
            La cuenta corriente del Tesoro de EE.UU. en la Fed. Cuando el Tesoro emite deuda y junta efectivo ahí,
            ese dinero sale del sistema bancario (drena liquidez). Cuando el Tesoro gasta (transferencias, sueldos,
            etc.), el dinero vuelve al sistema (agrega liquidez). Sube = liquidez saliendo del mercado.
          </p>
        </div>

        <div style={infoSectionStyle}>
          <div style={{ ...infoTermStyle, color: '#22d3ee' }}>Reverse Repo (RRP)</div>
          <p style={infoTextStyle}>
            Efectivo que money market funds y bancos estacionan overnight en la Fed a cambio de una tasa de interés,
            en vez de prestarlo al mercado. Es liquidez "parqueada", fuera de circulación. Sube = liquidez saliendo
            del mercado; baja = ese efectivo vuelve a circular.
          </p>
        </div>

        <div style={infoSectionStyle}>
          <div style={{ ...infoTermStyle, color: '#a78bfa' }}>Net Liquidity = WALCL − TGA − RRP</div>
          <p style={infoTextStyle}>
            La liquidez neta que efectivamente está disponible para el sistema financiero (y en última instancia,
            para activos de riesgo). Es el balance bruto de la Fed menos el efectivo que quedó "afuera" estacionado
            en TGA y RRP. Es la métrica que más correlaciona con el apetito de riesgo del mercado.
          </p>
        </div>

        <div style={{ ...infoSectionStyle, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '12px' }}>
          <div style={{ ...infoTermStyle, color: '#fff' }}>Cómo se relacionan</div>
          <p style={infoTextStyle}>
            WALCL sube o cae lento (decisión de política monetaria), mientras TGA y RRP se mueven más rápido por
            razones técnicas (emisión de deuda, vencimientos, tasas overnight) y suelen ser la fuente real de los
            movimientos de corto plazo en Net Liquidity. Por eso puede haber liquidez drenándose (Net Liquidity cae)
            incluso con la Fed en pausa o expandiendo WALCL: alcanza con que el Tesoro esté acumulando caja en la
            TGA (típico después de emitir deuda) o que suba el RRP. Una caída sostenida de Net Liquidity tiende a
            preceder presión bajista en activos de riesgo; una expansión sostenida, lo contrario — con rezago de
            días a semanas, no instantáneo.
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function MacroLiquidityPanel({ history, loading }: MacroLiquidityPanelProps) {
  const [showInfo, setShowInfo] = useState(false);
  if (loading) {
    return (
      <div style={panelContainerStyle}>
        <div style={topGlowBarStyle} />
        <div style={headerStyle}>
          <Droplets size={18} style={{ color: '#a78bfa', filter: 'drop-shadow(0 0 6px rgba(167,139,250,0.5))' }} />
          <h3 style={titleStyle}>FED LIQUIDITY MONITOR</h3>
        </div>
        <div style={loadingContainerStyle}>
          <div className="animate-pulse" style={loadingTextStyle}>
            Cargando datos de liquidez de la Fed...
          </div>
        </div>
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div style={panelContainerStyle}>
        <div style={topGlowBarStyle} />
        <div style={headerStyle}>
          <Droplets size={18} style={{ color: '#a78bfa', filter: 'drop-shadow(0 0 6px rgba(167,139,250,0.5))' }} />
          <h3 style={titleStyle}>FED LIQUIDITY MONITOR</h3>
        </div>
        <div style={errorContainerStyle}>
          <AlertCircle size={24} style={{ color: 'rgba(255,255,255,0.2)' }} />
          <div style={errorTitleStyle}>Sin datos todavía</div>
          <div style={errorDescStyle}>
            Este panel se completa con la primera corrida de <code>npm run macro:daily</code> (fuente: FRED API).
          </div>
        </div>
      </div>
    );
  }

  const latest = history[history.length - 1];
  const prior = weekAgoEntry(history);
  const walclDelta = prior ? latest.walcl - prior.walcl : null;
  const tgaDelta = prior ? latest.tga - prior.tga : null;
  const rrpDelta = prior ? latest.rrp - prior.rrp : null;
  const netDelta = prior ? latest.net_liquidity - prior.net_liquidity : null;
  const isExpanding = netDelta !== null && netDelta >= 0;

  const recentHistory = history.slice(-90);

  return (
    <div style={panelContainerStyle}>
      <div style={topGlowBarStyle} />
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Droplets size={18} style={{ color: '#a78bfa', filter: 'drop-shadow(0 0 6px rgba(167,139,250,0.5))' }} />
          <h3 style={titleStyle}>FED LIQUIDITY MONITOR</h3>
          <button onClick={() => setShowInfo(true)} style={infoButtonStyle} aria-label="¿Qué significan estos datos?">
            <Info size={13} />
          </button>
        </div>
        <div style={{
          ...regimeBadgeStyle,
          backgroundColor: isExpanding ? 'rgba(0,230,118,0.12)' : 'rgba(255,42,109,0.12)',
          color: isExpanding ? '#00e676' : '#ff2a6d',
          borderColor: isExpanding ? 'rgba(0,230,118,0.4)' : 'rgba(255,42,109,0.4)',
          boxShadow: isExpanding ? '0 0 10px rgba(0,230,118,0.15)' : '0 0 10px rgba(255,42,109,0.15)'
        }}>
          {isExpanding ? '🟢 LIQUIDEZ AUMENTANDO' : '🔴 LIQUIDEZ DRENÁNDOSE'}
        </div>
      </div>

      <div style={gridStyle}>
        <div style={cardStatStyle}>
          <h4 style={colHeaderStyle}>FED BALANCE (WALCL)</h4>
          <div style={bigValueStyle}>{formatBillions(latest.walcl)}</div>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: walclDelta !== null && walclDelta >= 0 ? '#00e676' : '#ff2a6d', fontFamily: 'monospace' }}>
            {formatDelta(walclDelta)} (7d)
          </div>
        </div>

        <div style={cardStatStyle}>
          <h4 style={colHeaderStyle}>TREASURY GEN. (TGA)</h4>
          <div style={bigValueStyle}>{formatBillions(latest.tga)}</div>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: tgaDelta !== null && tgaDelta <= 0 ? '#00e676' : '#ff2a6d', fontFamily: 'monospace' }}>
            {formatDelta(tgaDelta)} (7d)
          </div>
        </div>

        <div style={cardStatStyle}>
          <h4 style={colHeaderStyle}>REVERSE REPO (RRP)</h4>
          <div style={bigValueStyle}>{formatBillions(latest.rrp)}</div>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: rrpDelta !== null && rrpDelta <= 0 ? '#00e676' : '#ff2a6d', fontFamily: 'monospace' }}>
            {formatDelta(rrpDelta)} (7d)
          </div>
        </div>

        <div style={{ ...cardStatStyle, borderColor: 'rgba(167,139,250,0.3)', backgroundColor: 'rgba(167,139,250,0.06)' }}>
          <h4 style={{ ...colHeaderStyle, color: '#a78bfa' }}>NET LIQUIDITY</h4>
          <div style={{ ...bigValueStyle, color: '#a78bfa', textShadow: '0 0 10px rgba(167,139,250,0.3)' }}>{formatBillions(latest.net_liquidity)}</div>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: isExpanding ? '#00e676' : '#ff2a6d', fontFamily: 'monospace' }}>
            {formatDelta(netDelta)} (7d)
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
        <h4 style={sectionSubtitleStyle}>LIQUIDEZ FED — 4 MÉTRICAS (90D, ESCALA PROPIA)</h4>
        <LiquidityChartsStack history={recentHistory} />
      </div>

      <div style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.35)', textAlign: 'right', marginTop: 'auto', paddingTop: '4px' }}>
        al {latest.date} · fuente: FRED (WALCL, RRPONTSYD, WTREGEN)
      </div>

      {showInfo && <LiquidityInfoModal onClose={() => setShowInfo(false)} />}
    </div>
  );
}

const topGlowBarStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  height: '2px',
  background: 'linear-gradient(90deg, transparent, rgba(167, 139, 250, 0.6), transparent)',
  pointerEvents: 'none'
};

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
  height: '100%',
  boxSizing: 'border-box',
  position: 'relative',
  overflow: 'hidden'
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  borderBottom: '1px solid rgba(255,255,255,0.07)',
  paddingBottom: '10px'
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.92rem',
  fontWeight: 800,
  letterSpacing: '0.06em',
  color: '#a78bfa',
  textShadow: '0 0 12px rgba(167,139,250,0.25)'
};

const regimeBadgeStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  fontWeight: 800,
  padding: '4px 10px',
  borderRadius: '20px',
  borderWidth: '1px',
  borderStyle: 'solid',
  letterSpacing: '0.05em'
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, 1fr)',
  gap: '10px'
};

const cardStatStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  backgroundColor: 'rgba(255, 255, 255, 0.03)',
  border: '1px solid rgba(255, 255, 255, 0.05)',
  borderRadius: '10px',
  padding: '10px 12px'
};

const colHeaderStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.68rem',
  fontWeight: 800,
  color: 'rgba(255,255,255,0.45)',
  letterSpacing: '0.08em'
};

const sectionSubtitleStyle: React.CSSProperties = {
  margin: '4px 0 2px 0',
  fontSize: '0.7rem',
  fontWeight: 800,
  color: 'rgba(255,255,255,0.5)',
  letterSpacing: '0.08em'
};

const bigValueStyle: React.CSSProperties = {
  fontSize: '1.25rem',
  fontWeight: 800,
  fontFamily: 'monospace',
  color: '#fff',
  letterSpacing: '-0.02em'
};

const loadingContainerStyle: React.CSSProperties = {
  height: '200px',
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

const infoButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: '50%',
  color: 'rgba(255,255,255,0.6)',
  cursor: 'pointer',
  width: '20px',
  height: '20px',
  padding: 0,
  transition: 'all 0.2s ease'
};

const infoOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(0,0,0,0.65)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  padding: '20px',
  backdropFilter: 'blur(4px)'
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
  fontWeight: 800
};

const infoTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.78rem',
  lineHeight: 1.6,
  color: 'rgba(255,255,255,0.75)'
};
