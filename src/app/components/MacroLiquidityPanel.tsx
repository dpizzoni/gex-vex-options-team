import React, { useState } from 'react';
import { Droplets, AlertCircle } from 'lucide-react';

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
function SingleMetricChart({ label, color, data, formatValue }: {
  label: string;
  color: string;
  data: { date: string; value: number }[];
  formatValue: (v: number) => string;
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
    y: SINGLE_CHART_HEIGHT - ((d.value - min) / range) * SINGLE_CHART_HEIGHT,
    date: d.date,
    value: d.value
  }));
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
  const slotWidth = width / data.length;
  const hovered = hoveredIndex !== null ? points[hoveredIndex] : null;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '2px' }}>
        <span style={{ fontSize: '0.72rem', fontWeight: 800, color }}>{label}</span>
        <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>
          {formatValue(min)} — {formatValue(max)}
        </span>
      </div>
      <div style={{ position: 'relative', width: `${CHART_WIDTH_PERCENT}%` }}>
        <svg
          width="100%"
          height={SINGLE_CHART_HEIGHT + 4}
          viewBox={`0 0 ${width} ${SINGLE_CHART_HEIGHT + 4}`}
          preserveAspectRatio="none"
          style={{ display: 'block', overflow: 'visible' }}
        >
          <line x1={0} x2={width} y1={0} y2={0} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
          <line x1={0} x2={width} y1={SINGLE_CHART_HEIGHT} y2={SINGLE_CHART_HEIGHT} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
          <path d={path} fill="none" stroke={color} strokeWidth={1.75} />

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
              <line x1={hovered.x} x2={hovered.x} y1={0} y2={SINGLE_CHART_HEIGHT} stroke="rgba(255,255,255,0.25)" strokeDasharray="2,2" />
              <circle cx={hovered.x} cy={hovered.y} r={2.5} fill={color} />
            </>
          )}
        </svg>

        {hovered && (
          <div
            style={{
              position: 'absolute',
              left: `${(hovered.x / width) * 100}%`,
              top: 0,
              transform: 'translate(-50%, calc(-100% - 8px))',
              pointerEvents: 'none',
              display: 'flex',
              justifyContent: 'center'
            }}
          >
            <div style={{
              backgroundColor: 'rgba(10, 16, 35, 0.97)',
              border: `1px solid ${color}`,
              borderRadius: '6px',
              padding: '4px 8px',
              fontFamily: 'monospace',
              fontSize: '10px',
              lineHeight: 1.4,
              width: 'max-content',
              boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      {LIQUIDITY_SERIES.map(s => (
        <SingleMetricChart
          key={s.key}
          label={s.label}
          color={s.color}
          data={history.map(h => ({ date: h.date, value: h[s.key] }))}
          formatValue={formatBillions}
        />
      ))}
    </div>
  );
}

export default function MacroLiquidityPanel({ history, loading }: MacroLiquidityPanelProps) {
  if (loading) {
    return (
      <div style={panelContainerStyle}>
        <div style={headerStyle}>
          <Droplets size={18} style={{ color: '#a78bfa' }} />
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
        <div style={headerStyle}>
          <Droplets size={18} style={{ color: '#a78bfa' }} />
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
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Droplets size={18} style={{ color: '#a78bfa' }} />
          <h3 style={titleStyle}>FED LIQUIDITY MONITOR</h3>
        </div>
        <div style={{
          ...regimeBadgeStyle,
          backgroundColor: isExpanding ? 'rgba(0,230,118,0.1)' : 'rgba(255,42,109,0.1)',
          color: isExpanding ? '#00e676' : '#ff2a6d',
          borderColor: isExpanding ? '#00e676' : '#ff2a6d'
        }}>
          {isExpanding ? '🟢 LIQUIDEZ AUMENTANDO' : '🔴 LIQUIDEZ DRENÁNDOSE'}
        </div>
      </div>

      <div style={gridStyle}>
        <div style={colStyle}>
          <h4 style={colHeaderStyle}>FED BALANCE (WALCL)</h4>
          <div style={bigValueStyle}>{formatBillions(latest.walcl)}</div>
          <div style={{ fontSize: '0.75rem', color: walclDelta !== null && walclDelta >= 0 ? '#00e676' : '#ff2a6d', fontFamily: 'monospace' }}>
            {formatDelta(walclDelta)} (7d)
          </div>
        </div>

        <div style={colStyle}>
          <h4 style={colHeaderStyle}>TREASURY GENERAL ACCOUNT</h4>
          <div style={bigValueStyle}>{formatBillions(latest.tga)}</div>
          <div style={{ fontSize: '0.75rem', color: tgaDelta !== null && tgaDelta <= 0 ? '#00e676' : '#ff2a6d', fontFamily: 'monospace' }}>
            {formatDelta(tgaDelta)} (7d)
          </div>
        </div>

        <div style={colStyle}>
          <h4 style={colHeaderStyle}>REVERSE REPO (RRP)</h4>
          <div style={bigValueStyle}>{formatBillions(latest.rrp)}</div>
          <div style={{ fontSize: '0.75rem', color: rrpDelta !== null && rrpDelta <= 0 ? '#00e676' : '#ff2a6d', fontFamily: 'monospace' }}>
            {formatDelta(rrpDelta)} (7d)
          </div>
        </div>

        <div style={{ ...colStyle, borderRight: 'none' }}>
          <h4 style={colHeaderStyle}>NET LIQUIDITY (FED − TGA − RRP)</h4>
          <div style={{ ...bigValueStyle, color: '#a78bfa' }}>{formatBillions(latest.net_liquidity)}</div>
          <div style={{ fontSize: '0.75rem', color: isExpanding ? '#00e676' : '#ff2a6d', fontFamily: 'monospace' }}>
            {formatDelta(netDelta)} (7d)
          </div>
        </div>
      </div>

      <div>
        <h4 style={colHeaderStyle}>LIQUIDEZ FED — 4 MÉTRICAS (90D, ESCALA PROPIA)</h4>
        <LiquidityChartsStack history={recentHistory} />
      </div>

      <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.35)', textAlign: 'right' }}>
        al {latest.date} · fuente: FRED (WALCL, RRPONTSYD, WTREGEN)
      </div>
    </div>
  );
}

const panelContainerStyle: React.CSSProperties = {
  backgroundColor: 'rgba(10, 16, 35, 0.6)',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'rgba(255, 255, 255, 0.08)',
  borderRadius: '12px',
  padding: '20px',
  display: 'flex',
  flexDirection: 'column',
  gap: '20px',
  backdropFilter: 'blur(16px)',
  color: '#fff',
  margin: '0 1rem 1rem 1rem'
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
  paddingBottom: '12px'
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '1rem',
  fontWeight: 800,
  letterSpacing: '0.05em',
  color: '#a78bfa'
};

const regimeBadgeStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  fontWeight: 800,
  padding: '4px 10px',
  borderRadius: '20px',
  borderWidth: '1px',
  borderStyle: 'solid',
  letterSpacing: '0.05em'
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
  gap: '24px'
};

const colStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  borderRight: '1px solid rgba(255, 255, 255, 0.06)',
  paddingRight: '16px'
};

const colHeaderStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.75rem',
  fontWeight: 800,
  color: 'rgba(255,255,255,0.4)',
  letterSpacing: '0.08em'
};

const bigValueStyle: React.CSSProperties = {
  fontSize: '1.4rem',
  fontWeight: 700,
  fontFamily: 'monospace',
  color: '#fff'
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
