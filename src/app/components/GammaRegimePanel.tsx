import React from 'react';
import { ShieldAlert, Zap, Compass, Clock, Activity, AlertTriangle, AlertCircle } from 'lucide-react';
import { GammaRegimeOutput } from '@/lib/gamma-regime-engine';

interface GammaRegimePanelProps {
  regimeData: GammaRegimeOutput | null;
  loading: boolean;
  minHistoryCount: number;
}

export default function GammaRegimePanel({ regimeData, loading, minHistoryCount }: GammaRegimePanelProps) {
  if (loading) {
    return (
      <div style={panelContainerStyle}>
        <div style={headerStyle}>
          <Activity size={18} style={titleIconStyle} />
          <h3 style={titleStyle}>GAMMA REGIME ENGINE</h3>
        </div>
        <div style={loadingContainerStyle}>
          <div className="animate-pulse" style={loadingTextStyle}>
            Cargando análisis de régimen de volatilidad...
          </div>
        </div>
      </div>
    );
  }

  if (!regimeData) {
    return (
      <div style={panelContainerStyle}>
        <div style={headerStyle}>
          <Activity size={18} style={titleIconStyle} />
          <h3 style={titleStyle}>GAMMA REGIME ENGINE</h3>
        </div>
        <div style={errorContainerStyle}>
          <AlertCircle size={24} style={errorIconStyle} />
          <div style={errorTitleStyle}>Historial insuficiente</div>
          <div style={errorDescStyle}>
            El motor de régimen de gamma requiere un mínimo de 20 sesiones para activarse.
            <br />
            Se activará en <strong>{20 - minHistoryCount}</strong> sesiones adicionales.
          </div>
        </div>
      </div>
    );
  }

  const {
    regime,
    quadrant,
    duration,
    shiftStrengthNorm,
    shiftStrengthDesc,
    stabilityScore,
    stabilityDesc,
    netGexToday,
    deltaGex,
    ema3NetGex,
    forwardRegime,
    daysToPressure,
    pcForwardTrend,
    pressureExpirationDate,
    pressureExpirationGex,
    alerts
  } = regimeData;

  const isLong = regime === "LONG_GAMMA";
  const themeColor = isLong ? "#00e676" : "#ff2a6d";
  const bgGlow = isLong ? "rgba(0, 230, 118, 0.05)" : "rgba(255, 42, 109, 0.05)";
  const borderHighlight = isLong ? "rgba(0, 230, 118, 0.3)" : "rgba(255, 42, 109, 0.3)";

  const formatGex = (val: number) => {
    const absVal = Math.abs(val);
    const sign = val < 0 ? "-" : "";
    if (absVal >= 1.0e9) {
      return `${sign}$${(absVal / 1.0e9).toFixed(2)}B`;
    } else if (absVal >= 1.0e6) {
      return `${sign}$${(absVal / 1.0e6).toFixed(2)}M`;
    } else if (absVal >= 1.0e3) {
      return `${sign}$${(absVal / 1.0e3).toFixed(1)}K`;
    } else {
      return `${sign}$${absVal.toFixed(2)}`;
    }
  };

  const getInterpretationText = () => {
    if (isLong) {
      return `El activo opera bajo un régimen de absorción de movimientos (Long Gamma). La presión de volatilidad (VEX) actual coloca al mercado en el cuadrante de "${quadrant}". Si aparece un catalizador fuerte, la estructura podría volverse frágil; sin embargo, en condiciones normales se espera mean reversion intradía y pinning cerca del King Node.`;
    } else {
      return `El activo opera bajo un régimen de expansión y aceleración (Short Gamma). El cuadrante actual es "${quadrant}", lo que denota una alta probabilidad de trend days, expansión del rango de volatilidad y continuación rápida de rompimientos técnicos. Máxima precaución ante gaps con seguimiento.`;
    }
  };

  return (
    <div style={{ ...panelContainerStyle, borderColor: borderHighlight, boxShadow: `0 8px 32px 0 ${bgGlow}` }}>
      {/* Panel Header */}
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Activity size={18} style={{ color: themeColor }} />
          <h3 style={titleStyle}>GAMMA REGIME ENGINE</h3>
        </div>
        <div style={{ ...regimeBadgeStyle, backgroundColor: isLong ? 'rgba(0,230,118,0.1)' : 'rgba(255,42,109,0.1)', color: themeColor, borderColor: themeColor }}>
          {isLong ? 'LONG GAMMA' : 'SHORT GAMMA'}
        </div>
      </div>

      {/* Main Grid */}
      <div style={gridStyle}>
        {/* Col 1: Regime Info */}
        <div style={colStyle}>
          <h4 style={colHeaderStyle}>ESTADO DEL RÉGIMEN</h4>
          
          <div style={metricRowStyle}>
            <span style={labelStyle}>Cuadrante GEX-VEX:</span>
            <span style={{ ...valueStyle, color: '#fff', fontWeight: 700 }}>{quadrant}</span>
          </div>
          
          <div style={metricRowStyle}>
            <span style={labelStyle}>Duración del Régimen:</span>
            <span style={valueStyle}>{duration} {duration === 1 ? 'sesión' : 'sesiones'}</span>
          </div>

          <div style={metricRowStyle}>
            <span style={labelStyle}>Fuerza del Shift:</span>
            <span style={{ ...valueStyle, color: shiftStrengthDesc === 'Extremo' ? '#ff2a6d' : shiftStrengthDesc === 'Alto' ? '#ff9100' : '#fff' }}>
              {shiftStrengthDesc} ({shiftStrengthNorm.toFixed(1)}x)
            </span>
          </div>

          <div style={metricRowStyle}>
            <span style={labelStyle}>Estabilidad (20d):</span>
            <span style={{ ...valueStyle, color: stabilityScore >= 0.8 ? '#00e676' : stabilityScore >= 0.5 ? '#fff' : '#ff9100' }}>
              {(stabilityScore * 100).toFixed(0)}% ({stabilityDesc})
            </span>
          </div>
        </div>

        {/* Col 2: GEX Statistics */}
        <div style={colStyle}>
          <h4 style={colHeaderStyle}>MÉTRICAS DE FLUJO</h4>

          <div style={metricRowStyle}>
            <span style={labelStyle}>Net GEX hoy:</span>
            <span style={{ ...valueStyle, color: netGexToday >= 0 ? '#00e676' : '#ff2a6d', fontFamily: 'monospace' }}>
              {formatGex(netGexToday)}
            </span>
          </div>

          <div style={metricRowStyle}>
            <span style={labelStyle}>Delta GEX vs ayer:</span>
            <span style={{ ...valueStyle, color: deltaGex >= 0 ? '#00e676' : '#ff2a6d', fontFamily: 'monospace' }}>
              {deltaGex >= 0 ? '+' : ''}{formatGex(deltaGex)}
            </span>
          </div>

          <div style={metricRowStyle}>
            <span style={labelStyle}>EMA3 Net GEX:</span>
            <span style={{ ...valueStyle, color: ema3NetGex >= 0 ? '#00e676' : '#ff2a6d', fontFamily: 'monospace' }}>
              {formatGex(ema3NetGex)}
            </span>
          </div>

          <p style={interpretationStyle}>
            {getInterpretationText()}
          </p>
        </div>

        {/* Col 3: Forward Inferences */}
        <div style={{ ...colStyle, borderRight: 'none' }}>
          <h4 style={colHeaderStyle}>FORWARD SIGNAL</h4>

          <div style={metricRowStyle}>
            <span style={labelStyle}>Presión Forward:</span>
            <span style={{ ...valueStyle, color: forwardRegime.includes('SHORT') ? '#ff2a6d' : forwardRegime.includes('LONG') ? '#00e676' : '#fff', fontWeight: 600 }}>
              {forwardRegime.toUpperCase()}
            </span>
          </div>

          <div style={metricRowStyle}>
            <span style={labelStyle}>Días hasta Presión:</span>
            <span style={valueStyle}>{daysToPressure} {daysToPressure === 1 ? 'sesión' : 'sesiones'}</span>
          </div>

          <div style={metricRowStyle}>
            <span style={labelStyle}>P/C Forward Ratio:</span>
            <span style={{ ...valueStyle, color: pcForwardTrend > 1.2 ? '#ff2a6d' : pcForwardTrend < 0.8 ? '#00e676' : '#fff' }}>
              {pcForwardTrend.toFixed(2)} {pcForwardTrend > 1.2 ? '(Puts dom)' : pcForwardTrend < 0.8 ? '(Calls dom)' : '(Equilibrado)'}
            </span>
          </div>

          <p style={interpretationStyle}>
            La expiración del <strong>{pressureExpirationDate}</strong> (con un GEX de {formatGex(pressureExpirationGex)}) ejerce la mayor influencia estructural hacia adelante. Al expirar, se prevé una transición a un entorno {forwardRegime.includes('SHORT') ? 'de mayor volatilidad y menor soporte' : 'de mayor absorción y rango comprimido'}.
          </p>
        </div>
      </div>

      {/* Alerts Section */}
      {alerts && alerts.length > 0 && (
        <div style={alertsContainerStyle}>
          {alerts.map((alert, idx) => {
            const isAlertShort = alert.type === "SHORT_GAMMA_ENTRY" || alert.type === "EXTREME_NEGATIVE" || alert.type === "FORWARD_REGIME_PRESSURE";
            const alertColor = isAlertShort ? "#ff2a6d" : "#00e676";
            const alertBg = isAlertShort ? "rgba(255,42,109,0.06)" : "rgba(0,230,118,0.06)";
            const alertBorder = isAlertShort ? "rgba(255,42,109,0.25)" : "rgba(0,230,118,0.25)";
            
            return (
              <div key={idx} style={{ ...alertCardStyle, backgroundColor: alertBg, borderColor: alertBorder }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <AlertTriangle size={16} style={{ color: alertColor }} />
                  <span style={{ ...alertTitleStyle, color: alertColor }}>{alert.title}</span>
                </div>
                <div style={alertDescStyle}>{alert.description.split('\n\n').slice(1).join('\n\n')}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Inline Styles
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
  transition: 'all 0.3s ease',
  color: '#fff',
  height: '100%',
  marginTop: '0px'
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

const titleIconStyle: React.CSSProperties = {
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
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: '24px'
};

const colStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  borderRight: '1px solid rgba(255, 255, 255, 0.06)',
  paddingRight: '16px'
};

const colHeaderStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.75rem',
  fontWeight: 800,
  color: 'rgba(255,255,255,0.4)',
  letterSpacing: '0.08em',
  marginBottom: '4px'
};

const metricRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  fontSize: '0.875rem'
};

const labelStyle: React.CSSProperties = {
  color: 'rgba(255,255,255,0.6)'
};

const valueStyle: React.CSSProperties = {
  fontWeight: 600,
  color: '#f3f4f6'
};

const interpretationStyle: React.CSSProperties = {
  margin: '8px 0 0 0',
  fontSize: '0.785rem',
  lineHeight: 1.5,
  color: 'rgba(255,255,255,0.5)',
  textAlign: 'justify'
};

const loadingContainerStyle: React.CSSProperties = {
  height: '140px',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center'
};

const loadingTextStyle: React.CSSProperties = {
  fontSize: '0.875rem',
  color: 'rgba(255,255,255,0.4)'
};

const errorContainerStyle: React.CSSProperties = {
  padding: '30px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  gap: '12px'
};

const errorIconStyle: React.CSSProperties = {
  color: 'rgba(255,255,255,0.2)'
};

const errorTitleStyle: React.CSSProperties = {
  fontSize: '1rem',
  fontWeight: 700,
  color: 'rgba(255,255,255,0.8)'
};

const errorDescStyle: React.CSSProperties = {
  fontSize: '0.825rem',
  color: 'rgba(255,255,255,0.4)',
  lineHeight: 1.6
};

const alertsContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  borderTop: '1px solid rgba(255,255,255,0.06)',
  paddingTop: '16px'
};

const alertCardStyle: React.CSSProperties = {
  padding: '14px 18px',
  borderRadius: '10px',
  borderWidth: '1px',
  borderStyle: 'solid',
  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.1)',
  display: 'flex',
  flexDirection: 'column',
  gap: '4px'
};

const alertTitleStyle: React.CSSProperties = {
  fontSize: '0.825rem',
  fontWeight: 800,
  letterSpacing: '0.04em'
};

const alertDescStyle: React.CSSProperties = {
  fontSize: '0.785rem',
  lineHeight: 1.45,
  color: 'rgba(255,255,255,0.7)',
  whiteSpace: 'pre-line'
};
