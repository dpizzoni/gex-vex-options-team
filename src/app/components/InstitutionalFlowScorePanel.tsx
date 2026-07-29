import React from 'react';
import { Gauge, AlertCircle } from 'lucide-react';

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
  etf_flows: 'ETF Flows (SPY)'
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

export default function InstitutionalFlowScorePanel({ history, loading }: InstitutionalFlowScorePanelProps) {
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
