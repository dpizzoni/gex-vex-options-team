import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Gauge, AlertCircle, Info, X } from 'lucide-react';

export interface FlowScoreComponents {
  liquidity: number;
  credit_spread: number;
  dollar: number;
  vix: number;
  us10y: number;
  breadth: number;
  etf_flows: number;
}

export interface FlowScoreEntry {
  date: string;
  score: number;
  label: string;
  components: FlowScoreComponents;
  inputs: {
    net_liquidity: number;
    hy_oas: number;
    ig_oas?: number | null;
    dxy: number;
    vix: number;
    us10y: number;
    real_yield_10y?: number | null;
    qqq_pct_5d: number | null;
    qqqe_pct_5d: number | null;
    spy_net_flow: number | null;
    qqq_net_flow: number | null;
    iwm_net_flow: number | null;
    etf_net_flow_total: number | null;
  };
}

interface InstitutionalFlowScorePanelProps {
  history: FlowScoreEntry[];
  loading: boolean;
}

const MAX_ABS_SCORE = 13; // sum of each component's max magnitude (2+2+2+2+1+2+2)

const COMPONENT_LABELS: Record<keyof FlowScoreComponents, string> = {
  liquidity: 'Liquidez (Fed − TGA − RRP)',
  credit_spread: 'Credit Spread (HY OAS)',
  dollar: 'Dólar (DXY, banda ancha)',
  vix: 'VIX',
  us10y: 'US10Y',
  breadth: 'Breadth (QQQ vs QQQE)',
  etf_flows: 'ETF Flows (SPY+QQQ+IWM)'
};

const COMPONENT_ORDER: (keyof FlowScoreComponents)[] = ['liquidity', 'credit_spread', 'dollar', 'vix', 'us10y', 'breadth', 'etf_flows'];

// Same "closest entry ~7 calendar days back" idea as the backend's
// weekAgoEntry (generate-institutional-analysis.js) - approximate is fine,
// this is just for a delta hint next to the raw level, not the score itself.
function weekAgoEntry(history: FlowScoreEntry[], latestDate: string): FlowScoreEntry | null {
  const target = new Date(latestDate);
  target.setUTCDate(target.getUTCDate() - 7);
  const targetStr = target.toISOString().slice(0, 10);
  let candidate: FlowScoreEntry | null = null;
  for (const e of history) {
    if (e.date <= targetStr) candidate = e;
    else break;
  }
  return candidate;
}

const RAW_LEVELS: { key: keyof FlowScoreEntry['inputs']; label: string; decimals: number; suffix: string }[] = [
  { key: 'vix', label: 'VIX', decimals: 1, suffix: '' },
  { key: 'dxy', label: 'DXY', decimals: 1, suffix: '' },
  { key: 'us10y', label: 'US10Y', decimals: 2, suffix: '%' },
  { key: 'real_yield_10y', label: 'Real Yield 10Y', decimals: 2, suffix: '%' },
  { key: 'hy_oas', label: 'HY OAS', decimals: 2, suffix: 'pp' },
  { key: 'ig_oas', label: 'IG OAS', decimals: 2, suffix: 'pp' }
];

function RawLevelsStrip({ history }: { history: FlowScoreEntry[] }) {
  const latest = history[history.length - 1];
  const prior = weekAgoEntry(history, latest.date);

  return (
    <div style={{ paddingTop: '6px' }}>
      <h4 style={colHeaderStyle}>NIVELES DE MERCADO (crudo, no score)</h4>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {RAW_LEVELS.map(({ key, label, decimals, suffix }) => {
          const value = latest.inputs[key];
          if (value == null) return null;
          const priorValue = prior?.inputs[key];
          const delta = priorValue != null ? (value as number) - priorValue : null;
          return (
            <div key={key} style={{
              flex: '1 1 110px',
              backgroundColor: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.05)',
              borderRadius: '6px',
              padding: '6px 10px',
              display: 'flex',
              flexDirection: 'column',
              gap: '2px'
            }}>
              <span style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.45)', letterSpacing: '0.03em' }}>{label}</span>
              <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.85rem', color: '#e2e8f0' }}>
                {(value as number).toFixed(decimals)}{suffix}
              </span>
              {delta != null && (
                <span style={{
                  fontFamily: 'monospace',
                  fontSize: '0.62rem',
                  fontWeight: 600,
                  color: delta > 0 ? '#00e676' : delta < 0 ? '#ff2a6d' : 'rgba(255,255,255,0.35)'
                }}>
                  {delta >= 0 ? '+' : ''}{delta.toFixed(decimals)}{suffix} (7d)
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function labelColor(label: string): string {
  if (label === 'Strong Buying' || label === 'Buying') return '#00e676';
  if (label === 'Strong Distribution' || label === 'Distribution') return '#ff2a6d';
  return '#ffb020';
}

function labelEs(label: string): string {
  switch (label) {
    case 'Strong Buying': return 'Acumulación Fuerte';
    case 'Buying': return 'Acumulación';
    case 'Strong Distribution': return 'Distribución Fuerte';
    case 'Distribution': return 'Distribución';
    default: return 'Neutral';
  }
}

function ComponentBar({ value }: { value: number }) {
  const max = 2;
  const pct = (Math.abs(value) / max) * 50;
  const color = value > 0 ? '#00e676' : value < 0 ? '#ff2a6d' : 'rgba(255,255,255,0.2)';
  return (
    <div style={{ position: 'relative', height: '8px', width: '100px', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: '4px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.05)' }}>
      <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: '1px', backgroundColor: 'rgba(255,255,255,0.25)', zIndex: 2 }} />
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          width: `${pct}%`,
          backgroundColor: color,
          left: value >= 0 ? '50%' : `${50 - pct}%`,
          boxShadow: value !== 0 ? `0 0 6px ${color}80` : 'none'
        }}
      />
    </div>
  );
}

function FlowScoreInfoModal({ onClose }: { onClose: () => void }) {
  return createPortal(
    <div style={infoOverlayStyle} onClick={onClose}>
      <div style={infoModalStyle} onClick={e => e.stopPropagation()}>
        <div style={infoModalHeaderStyle}>
          <span style={{ fontWeight: 800, fontSize: '0.95rem', color: '#a78bfa' }}>¿Qué es el Institutional Flow Score?</span>
          <button onClick={onClose} style={infoCloseButtonStyle} aria-label="Cerrar"><X size={16} /></button>
        </div>

        <p style={infoTextStyle}>
          Un modelo cuantitativo (no es IA) que suma 7 componentes, cada uno puntuado entre -2 y +2 (US10Y entre
          -1 y +1) según cómo cambió esa variable en los últimos 7 días. El total va de -13 a +13 y se traduce en
          una etiqueta: Acumulación Fuerte / Acumulación / Neutral / Distribución / Distribución Fuerte.
        </p>

        <div style={infoSectionStyle}>
          <div style={infoTermStyle}>Liquidez (Fed − TGA − RRP)</div>
          <p style={infoTextStyle}>Net Liquidity subiendo &gt;0.5% en 7d suma, cayendo &gt;0.5% resta. Más liquidez en el sistema, más combustible para activos de riesgo.</p>
        </div>
        <div style={infoSectionStyle}>
          <div style={infoTermStyle}>Credit Spread (HY OAS)</div>
          <p style={infoTextStyle}>El spread de crédito high-yield comprimiéndose (&gt;0.15pp en 7d) suma — señal de apetito por riesgo. Ampliándose, resta.</p>
        </div>
        <div style={infoSectionStyle}>
          <div style={infoTermStyle}>Dólar (DXY, banda ancha)</div>
          <p style={infoTextStyle}>Dólar debilitándose (&gt;1% en 7d) suma — típicamente favorece activos de riesgo y flujos hacia emergentes/commodities. Fortaleciéndose, resta.</p>
        </div>
        <div style={infoSectionStyle}>
          <div style={infoTermStyle}>VIX</div>
          <p style={infoTextStyle}>Nivel bajo (&lt;15) o cayendo fuerte suma; nivel alto (&gt;25) o subiendo fuerte (&gt;3pts en 7d) resta. Mide miedo/cobertura.</p>
        </div>
        <div style={infoSectionStyle}>
          <div style={infoTermStyle}>US10Y</div>
          <p style={infoTextStyle}>Rendimiento del bono a 10 años cayendo (&gt;0.15pp en 7d) suma — menor costo de capital. Subiendo, resta. Rango acotado (-1 a +1).</p>
        </div>
        <div style={infoSectionStyle}>
          <div style={infoTermStyle}>Breadth (QQQ vs QQQE)</div>
          <p style={infoTextStyle}>Compara el Nasdaq 100 cap-weighted (QQQ) contra su versión equal-weight (QQQE) a 5 días. Si QQQE le gana a QQQ, la suba es amplia (no solo mega-caps) y suma. Si QQQ le gana por mucho, la suba es angosta y resta.</p>
        </div>
        <div style={infoSectionStyle}>
          <div style={infoTermStyle}>ETF Flows (SPY+QQQ+IWM)</div>
          <p style={infoTextStyle}>Flujo neto en dólares hacia los 3 ETFs de índice más grandes. Más de $1B de entrada suma, más de $1B de salida resta.</p>
        </div>

        <div style={{ ...infoSectionStyle, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '12px' }}>
          <div style={{ ...infoTermStyle, color: '#a78bfa' }}>Niveles de Mercado (debajo del breakdown)</div>
          <p style={infoTextStyle}>
            VIX, DXY y US10Y son los mismos inputs de arriba, pero en su valor crudo — el score arriba comprime cada
            uno a -2..+2 según cómo cambió en 7d, así que un componente en 0 puede ser "genuinamente neutral" o "dos
            movimientos que se cancelaron"; el nivel + delta acá distingue eso. HY OAS e IG OAS (spreads de crédito
            investment grade) no entran al score, solo dan contexto: comparalos entre sí para ver si el crédito está
            precificando riesgo idiosincrático en high yield o un deterioro genérico. Real Yield 10Y (tasa real a 10
            años, TIPS) tampoco entra al score — es el driver de costo de oportunidad detrás de activos sin yield
            como el oro, más específico que US10Y nominal porque aísla el componente que de verdad mueve esa demanda.
          </p>
        </div>

        <div style={{ ...infoSectionStyle, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '12px' }}>
          <div style={{ ...infoTermStyle, color: '#fff' }}>Cómo se relacionan</div>
          <p style={infoTextStyle}>
            Liquidez, crédito, dólar y tasas describen el contexto macro (¿hay viento de cola o de frente para
            activos de riesgo?), mientras que VIX, breadth y ETF flows describen el comportamiento real del
            mercado en ese contexto (¿el dinero se está moviendo acorde a lo que el macro sugiere?). Cuando ambos
            grupos apuntan para el mismo lado, el score es más confiable; cuando divergen (ej. macro favorable pero
            flujos saliendo), es la señal de alerta más útil — el mercado no está confirmando lo que la liquidez
            sugiere.
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function InstitutionalFlowScorePanel({ history, loading }: InstitutionalFlowScorePanelProps) {
  const [showInfo, setShowInfo] = useState(false);
  const scoreStripRef = useRef<HTMLDivElement>(null);

  // Default the horizontal scroll to the right edge so the most recent bars
  // (today's score, at the end of the array) are what's visible without the
  // user having to scroll manually - matters now that the strip holds 30
  // days instead of 10 and rarely fits without scrolling.
  useEffect(() => {
    const el = scoreStripRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [history]);

  if (loading) {
    return (
      <div style={panelContainerStyle}>
        <div style={topGlowBarStyle} />
        <div style={headerStyle}>
          <Gauge size={18} style={{ color: '#a78bfa', filter: 'drop-shadow(0 0 6px rgba(167,139,250,0.5))' }} />
          <h3 style={titleStyle}>INSTITUTIONAL FLOW SCORE</h3>
        </div>
        <div style={loadingContainerStyle}>
          <div className="animate-pulse" style={loadingTextStyle}>
            Calculando score institucional...
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
          <Gauge size={18} style={{ color: '#a78bfa', filter: 'drop-shadow(0 0 6px rgba(167,139,250,0.5))' }} />
          <h3 style={titleStyle}>INSTITUTIONAL FLOW SCORE</h3>
        </div>
        <div style={errorContainerStyle}>
          <AlertCircle size={24} style={{ color: 'rgba(255,255,255,0.2)' }} />
          <div style={errorTitleStyle}>Sin datos todavía</div>
          <div style={errorDescStyle}>
            Este panel se completa con la primera corrida de <code>npm run score:daily</code>.
          </div>
        </div>
      </div>
    );
  }

  const latest = history[history.length - 1];
  const color = labelColor(latest.label);
  const recent = history.slice(-30);
  const maxRecentAbsScore = Math.max(4, ...recent.map(e => Math.abs(e.score)));

  const percent = (latest.score + MAX_ABS_SCORE) / (2 * MAX_ABS_SCORE);
  const clampedPercent = Math.max(0, Math.min(1, percent));
  const rotation = clampedPercent * 180 - 90;

  return (
    <div style={panelContainerStyle}>
      <div style={topGlowBarStyle} />
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Gauge size={18} style={{ color: '#a78bfa', filter: 'drop-shadow(0 0 6px rgba(167,139,250,0.5))' }} />
          <h3 style={titleStyle}>INSTITUTIONAL FLOW SCORE</h3>
          <button onClick={() => setShowInfo(true)} style={infoButtonStyle} aria-label="¿Qué significan estos datos?">
            <Info size={13} />
          </button>
        </div>
        <div style={{
          ...badgeStyle,
          backgroundColor: `${color}1a`,
          color,
          borderColor: `${color}60`,
          boxShadow: `0 0 10px ${color}20`
        }}>
          {labelEs(latest.label)}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '24px', padding: '10px 0' }}>
        
        {/* Left: Gauge Meter (no subcontainer) */}
        <div style={{ position: 'relative', width: '220px', height: '160px', display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="220" height="140" viewBox="0 0 220 140" style={{ overflow: 'visible' }}>
            <defs>
              <linearGradient id="flowGauge" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#ff2a6d" />
                <stop offset="50%" stopColor="#fbbf24" />
                <stop offset="100%" stopColor="#00e676" />
              </linearGradient>
            </defs>
            {/* Background Track */}
            <path d="M 30 110 A 80 80 0 0 1 190 110" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="16" strokeLinecap="round" />
            
            {/* Colored Gradient Arc */}
            <path d="M 30 110 A 80 80 0 0 1 190 110" fill="none" stroke="url(#flowGauge)" strokeWidth="16" strokeLinecap="round" style={{ filter: 'drop-shadow(0 0 8px rgba(251,191,36,0.3))' }} />
            
            {/* Labels for bounds */}
            <text x="30" y="134" fill="rgba(255,255,255,0.4)" fontSize="11" fontFamily="monospace" textAnchor="middle" fontWeight="bold">-{MAX_ABS_SCORE}</text>
            <text x="190" y="134" fill="rgba(255,255,255,0.4)" fontSize="11" fontFamily="monospace" textAnchor="middle" fontWeight="bold">+{MAX_ABS_SCORE}</text>
            
            {/* Needle */}
            <g transform={`translate(110, 110) rotate(${rotation})`}>
              <polygon points="-4,0 4,0 0,-74" fill="#ffffff" style={{ filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.6))' }} />
              <circle cx="0" cy="0" r="6" fill="#ffffff" />
              <circle cx="0" cy="0" r="2" fill="#0a1023" />
            </g>
          </svg>
          
          <div style={{ position: 'absolute', bottom: '0', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ fontSize: '2.8rem', fontWeight: 800, fontFamily: 'monospace', color, textShadow: `0 0 24px ${color}60`, lineHeight: 1 }}>
              {latest.score >= 0 ? '+' : ''}{latest.score}
            </div>
          </div>
        </div>

        {/* Right: Breakdown List */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {COMPONENT_ORDER.map(key => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.73rem', backgroundColor: 'rgba(255,255,255,0.02)', padding: '6px 10px', borderRadius: '6px' }}>
              <span style={{ color: 'rgba(255,255,255,0.7)', flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{COMPONENT_LABELS[key]}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
                <ComponentBar value={latest.components[key]} />
                <span style={{ fontFamily: 'monospace', fontWeight: 700, color: latest.components[key] > 0 ? '#00e676' : latest.components[key] < 0 ? '#ff2a6d' : 'rgba(255,255,255,0.4)', width: '24px', textAlign: 'right' }}>
                  {latest.components[key] >= 0 ? '+' : ''}{latest.components[key]}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <RawLevelsStrip history={history} />

      {recent.length > 1 && (
        <div style={{ paddingTop: '6px' }}>
          <h4 style={colHeaderStyle}>SCORE (ÚLTIMOS {recent.length} DÍAS)</h4>
          <div ref={scoreStripRef} style={{ display: 'flex', gap: '4px', alignItems: 'center', height: '72px', padding: '4px 6px', backgroundColor: 'rgba(0,0,0,0.15)', borderRadius: '6px', overflowX: 'auto' }}>
            {recent.map(e => {
              const h = Math.max(3, (Math.abs(e.score) / maxRecentAbsScore) * 30);
              const c = labelColor(e.label);
              return (
                <div key={e.date} title={`${e.date}: ${e.score}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: '0 0 24px' }}>
                  <div style={{ width: '100%', height: '60px', position: 'relative' }}>
                    {/* Zero line */}
                    <div style={{ position: 'absolute', top: '30px', left: 0, right: 0, height: '1px', backgroundColor: 'rgba(255,255,255,0.08)', zIndex: 1 }} />
                    {e.score >= 0 ? (
                      <div style={{ position: 'absolute', bottom: '30px', left: 0, width: '100%', height: `${h}px`, backgroundColor: c, borderRadius: '2px 2px 0 0', boxShadow: `0 0 4px ${c}60`, zIndex: 2 }} />
                    ) : (
                      <div style={{ position: 'absolute', top: '30px', left: 0, width: '100%', height: `${h}px`, backgroundColor: c, borderRadius: '0 0 2px 2px', boxShadow: `0 0 4px ${c}60`, zIndex: 2 }} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.35)', textAlign: 'right', marginTop: '4px' }}>
        al {latest.date} · modelo cuantitativo, no es IA
      </div>

      {showInfo && <FlowScoreInfoModal onClose={() => setShowInfo(false)} />}
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

const badgeStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  fontWeight: 800,
  padding: '4px 10px',
  borderRadius: '20px',
  borderWidth: '1px',
  borderStyle: 'solid',
  letterSpacing: '0.05em'
};

const heroScoreBoxStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  padding: '12px',
  backgroundColor: 'rgba(255, 255, 255, 0.02)',
  border: '1px solid rgba(255, 255, 255, 0.04)',
  borderRadius: '10px'
};

const colHeaderStyle: React.CSSProperties = {
  margin: '0 0 6px 0',
  fontSize: '0.68rem',
  fontWeight: 800,
  color: 'rgba(255,255,255,0.45)',
  letterSpacing: '0.08em'
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
  fontWeight: 800,
  color: '#a78bfa'
};

const infoTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.78rem',
  lineHeight: 1.6,
  color: 'rgba(255,255,255,0.75)'
};
