import React, { useState } from 'react';
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
    dxy: number;
    vix: number;
    us10y: number;
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
    <div style={{ position: 'relative', height: '8px', width: '100px', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: '4px', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: '1px', backgroundColor: 'rgba(255,255,255,0.2)' }} />
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          width: `${pct}%`,
          backgroundColor: color,
          left: value >= 0 ? '50%' : `${50 - pct}%`
        }}
      />
    </div>
  );
}

function FlowScoreInfoModal({ onClose }: { onClose: () => void }) {
  // Portal to document.body: same backdrop-filter stacking-context issue as
  // the other panels' info/history modals.
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

  if (loading) {
    return (
      <div style={panelContainerStyle}>
        <div style={headerStyle}>
          <Gauge size={18} style={{ color: '#a78bfa' }} />
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
        <div style={headerStyle}>
          <Gauge size={18} style={{ color: '#a78bfa' }} />
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
  const recent = history.slice(-10);

  return (
    <div style={panelContainerStyle}>
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Gauge size={18} style={{ color: '#a78bfa' }} />
          <h3 style={titleStyle}>INSTITUTIONAL FLOW SCORE</h3>
          <button onClick={() => setShowInfo(true)} style={infoButtonStyle} aria-label="¿Qué significan estos datos?">
            <Info size={14} />
          </button>
        </div>
        <div style={{ ...badgeStyle, backgroundColor: `${color}1a`, color, borderColor: color }}>
          {labelEs(latest.label)}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '32px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', minWidth: '140px' }}>
          <div style={{ fontSize: '2.5rem', fontWeight: 800, fontFamily: 'monospace', color }}>
            {latest.score >= 0 ? '+' : ''}{latest.score}
          </div>
          <div style={{ width: '140px', height: '10px', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: '5px', overflow: 'hidden', position: 'relative' }}>
            <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: '2px', backgroundColor: 'rgba(255,255,255,0.25)' }} />
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                backgroundColor: color,
                width: `${(Math.abs(latest.score) / MAX_ABS_SCORE) * 50}%`,
                left: latest.score >= 0 ? '50%' : `${50 - (Math.abs(latest.score) / MAX_ABS_SCORE) * 50}%`
              }}
            />
          </div>
          <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.35)' }}>rango: -{MAX_ABS_SCORE} a +{MAX_ABS_SCORE}</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, minWidth: '260px' }}>
          {COMPONENT_ORDER.map(key => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.75rem' }}>
              <span style={{ color: 'rgba(255,255,255,0.6)', flex: '0 0 190px' }}>{COMPONENT_LABELS[key]}</span>
              <ComponentBar value={latest.components[key]} />
              <span style={{ fontFamily: 'monospace', fontWeight: 700, color: latest.components[key] > 0 ? '#00e676' : latest.components[key] < 0 ? '#ff2a6d' : 'rgba(255,255,255,0.4)', minWidth: '28px', textAlign: 'right' }}>
                {latest.components[key] >= 0 ? '+' : ''}{latest.components[key]}
              </span>
            </div>
          ))}
        </div>
      </div>

      {recent.length > 1 && (
        <div>
          <h4 style={colHeaderStyle}>SCORE (ÚLTIMOS {recent.length} DÍAS)</h4>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-end', height: '36px' }}>
            {recent.map(e => {
              const h = Math.max(4, (Math.abs(e.score) / MAX_ABS_SCORE) * 36);
              const c = labelColor(e.label);
              return (
                <div key={e.date} title={`${e.date}: ${e.score}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', flex: 1 }}>
                  <div style={{ width: '100%', height: '36px', display: 'flex', alignItems: e.score >= 0 ? 'flex-end' : 'flex-start' }}>
                    <div style={{ width: '100%', height: `${h}px`, backgroundColor: c, borderRadius: '2px' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.35)', textAlign: 'right' }}>
        al {latest.date} · modelo cuantitativo, no es IA
      </div>

      {showInfo && <FlowScoreInfoModal onClose={() => setShowInfo(false)} />}
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

const badgeStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  fontWeight: 800,
  padding: '4px 10px',
  borderRadius: '20px',
  borderWidth: '1px',
  borderStyle: 'solid',
  letterSpacing: '0.05em'
};

const colHeaderStyle: React.CSSProperties = {
  margin: '0 0 8px 0',
  fontSize: '0.75rem',
  fontWeight: 800,
  color: 'rgba(255,255,255,0.4)',
  letterSpacing: '0.08em'
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

const infoButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: '50%',
  color: 'rgba(255,255,255,0.5)',
  cursor: 'pointer',
  width: '20px',
  height: '20px',
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
