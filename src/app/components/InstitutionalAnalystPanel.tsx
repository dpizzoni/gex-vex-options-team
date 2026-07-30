import React, { useState } from 'react';
import { Bot, AlertCircle, ChevronDown } from 'lucide-react';

export interface InstitutionalAnalysisEntry {
  date: string;
  narrative: string;
  model: string;
  generated_at: string;
}

interface InstitutionalAnalystPanelProps {
  history: InstitutionalAnalysisEntry[];
  loading: boolean;
}

export default function InstitutionalAnalystPanel({ history, loading }: InstitutionalAnalystPanelProps) {
  const [showHistory, setShowHistory] = useState(false);

  if (loading) {
    return (
      <div style={panelContainerStyle}>
        <div style={headerStyle}>
          <Bot size={18} style={{ color: '#a78bfa' }} />
          <h3 style={titleStyle}>INSTITUTIONAL ANALYST</h3>
        </div>
        <div style={loadingContainerStyle}>
          <div className="animate-pulse" style={loadingTextStyle}>
            Generando análisis institucional...
          </div>
        </div>
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div style={panelContainerStyle}>
        <div style={headerStyle}>
          <Bot size={18} style={{ color: '#a78bfa' }} />
          <h3 style={titleStyle}>INSTITUTIONAL ANALYST</h3>
        </div>
        <div style={errorContainerStyle}>
          <AlertCircle size={24} style={{ color: 'rgba(255,255,255,0.2)' }} />
          <div style={errorTitleStyle}>Sin análisis todavía</div>
          <div style={errorDescStyle}>
            Este panel se completa con la primera corrida de <code>npm run analysis:daily</code>.
          </div>
        </div>
      </div>
    );
  }

  const sorted = [...history].sort((a, b) => b.date.localeCompare(a.date));
  const latest = sorted[0];
  const previous = sorted.slice(1);

  return (
    <div style={panelContainerStyle}>
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Bot size={18} style={{ color: '#a78bfa' }} />
          <h3 style={titleStyle}>INSTITUTIONAL ANALYST</h3>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={modelBadgeStyle}>{latest.model}</span>
          <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)' }}>al {latest.date}</span>
        </div>
      </div>

      <p style={narrativeStyle}>{latest.narrative}</p>

      {previous.length > 0 && (
        <div>
          <button onClick={() => setShowHistory(v => !v)} style={historyToggleStyle}>
            <ChevronDown size={14} style={{ transform: showHistory ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            {showHistory ? 'Ocultar' : 'Ver'} días anteriores ({previous.length})
          </button>
          {showHistory && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '10px' }}>
              {previous.map(e => (
                <div key={e.date} style={historyItemStyle}>
                  <div style={historyDateStyle}>{e.date}</div>
                  <p style={{ ...narrativeStyle, fontSize: '0.78rem', color: 'rgba(255,255,255,0.6)' }}>{e.narrative}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
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
  gap: '16px',
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

const modelBadgeStyle: React.CSSProperties = {
  fontSize: '0.65rem',
  fontWeight: 700,
  padding: '2px 8px',
  borderRadius: '10px',
  backgroundColor: 'rgba(167,139,250,0.1)',
  color: '#a78bfa',
  border: '1px solid rgba(167,139,250,0.3)',
  fontFamily: 'monospace'
};

const narrativeStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.9rem',
  lineHeight: 1.7,
  color: 'rgba(255,255,255,0.85)',
  whiteSpace: 'pre-line'
};

const historyToggleStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  background: 'none',
  border: 'none',
  color: '#a78bfa',
  fontSize: '0.75rem',
  fontWeight: 700,
  cursor: 'pointer',
  padding: 0
};

const historyItemStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  paddingTop: '10px',
  borderTop: '1px solid rgba(255,255,255,0.06)'
};

const historyDateStyle: React.CSSProperties = {
  fontSize: '0.7rem',
  fontWeight: 700,
  color: 'rgba(255,255,255,0.4)'
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
