import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Radar, AlertCircle, Info, X } from 'lucide-react';
import EtfHoldingsTooltip, { EtfHoldingsMap, finvizUrl } from './EtfHoldingsTooltip';

export interface RelativeStrengthAlert {
  id: string;
  date: string;
  rule: string;
  bucket: 'liderazgo' | 'rotacion' | 'confirmacion' | 'persistencia';
  ticker: string;
  name: string;
  text: string;
  sortMagnitude: number;
}

export interface RelativeStrengthAlertsData {
  date: string | null;
  generatedAt: string | null;
  dynamicCutoffs?: { delta1WCutoff: number; delta1MCutoff: number; divergenceDelta1WCutoff: number };
  buckets: {
    liderazgo: RelativeStrengthAlert[];
    rotacion: RelativeStrengthAlert[];
    confirmacion: RelativeStrengthAlert[];
    persistencia: RelativeStrengthAlert[];
  };
}

interface RelativeStrengthAlertsPanelProps {
  data: RelativeStrengthAlertsData | null;
  loading: boolean;
  etfHoldings: EtfHoldingsMap;
}

type BucketKey = keyof RelativeStrengthAlertsData['buckets'];

const BUCKET_ORDER: BucketKey[] = ['liderazgo', 'rotacion', 'confirmacion', 'persistencia'];

// The 3 top-row columns, left to right - persistencia renders separately as
// a full-width strip below (see BucketStrip), not part of this grid.
const COLUMN_BUCKETS: BucketKey[] = ['liderazgo', 'rotacion', 'confirmacion'];

const BUCKET_LABELS: Record<BucketKey, string> = {
  liderazgo: 'Nuevos líderes / rezagados',
  rotacion: 'Rotación acelerada',
  confirmacion: 'Confirmación / divergencia',
  persistencia: 'Persistencia / nuevos elegibles'
};

const BUCKET_ACCENT: Record<BucketKey, string> = {
  liderazgo: '#a78bfa',
  rotacion: '#fbbf24',
  confirmacion: '#38bdf8',
  persistencia: '#00e676'
};

const RULE_COLOR: Record<string, string> = {
  LEADER_CROSS_UP: '#00e676',
  LEADER_CROSS_DOWN: '#ff2a6d',
  REGIME_CROSS_UP: '#00e676',
  REGIME_CROSS_DOWN: '#ff2a6d',
  ROTATION_ACCEL: '#fbbf24',
  LEVEL_PLUS_ACCEL: '#00e676',
  DIVERGENCE_UP: '#00e676',
  DIVERGENCE_DOWN: '#ff2a6d',
  CONFIRMED_LEADER: '#00e676',
  SUSTAINED_LEADERSHIP: '#00e676',
  NEWLY_ELIGIBLE: '#38bdf8'
};

function ruleColor(rule: string): string {
  return RULE_COLOR[rule] ?? 'rgba(255,255,255,0.6)';
}

function AlertsInfoModal({ onClose }: { onClose: () => void }) {
  return createPortal(
    <div style={infoOverlayStyle} onClick={onClose}>
      <div style={infoModalStyle} onClick={e => e.stopPropagation()}>
        <div style={infoModalHeaderStyle}>
          <span style={{ fontWeight: 800, fontSize: '0.95rem', color: '#a78bfa' }}>¿Qué son las Alertas de Fuerza Relativa?</span>
          <button onClick={onClose} style={infoCloseButtonStyle} aria-label="Cerrar"><X size={16} /></button>
        </div>

        <p style={infoTextStyle}>
          No es una campanita de notificaciones - es un mapa de situación que se reacomoda día a día con lo que
          disparó en la corrida más reciente de Fuerza Relativa (mismo cadence que el panel de arriba, al cierre).
          8 reglas agrupadas en 4 categorías; los buckets vacíos no se muestran - es señal honesta, no un error.
        </p>

        <div style={infoSectionStyle}>
          <div style={{ ...infoTermStyle, color: BUCKET_ACCENT.liderazgo }}>Nuevos líderes / rezagados</div>
          <p style={infoTextStyle}>
            Un ticker cruza el score 80% hacia arriba (nuevo líder) o 20% hacia abajo (nuevo rezagado), o cruza el
            50% (más fuerte/débil que el benchmark) sostenido 2 cierres consecutivos para filtrar ruido justo en
            el punto medio.
          </p>
        </div>
        <div style={infoSectionStyle}>
          <div style={{ ...infoTermStyle, color: BUCKET_ACCENT.rotacion }}>Rotación acelerada</div>
          <p style={infoTextStyle}>
            Δ1W Y Δ1M del score, ambos a la vez, entre el 12% más extremo del universo ese día (no un umbral fijo -
            el score es un percentil que ya de por sí se mueve mucho, así que el corte se recalcula todos los días
            contra la distribución real). Exigir las dos ventanas a la vez filtra el ruido de un movimiento fuerte
            en una sola ventana. "Nivel + aceleración" combina el mismo corte de Δ1W con un score ya alto (≥70%):
            líder ganando tracción, no solo estable.
          </p>
        </div>
        <div style={infoSectionStyle}>
          <div style={{ ...infoTermStyle, color: BUCKET_ACCENT.confirmacion }}>Confirmación / divergencia</div>
          <p style={infoTextStyle}>
            Divergencia: el score sube mientras el retorno semanal de precio es plano/negativo, o viceversa (útil
            para detectar rotación relativa antes de que se note en precio). Líder confirmado: score alto y precio
            cerca de su máximo de 52 semanas al mismo tiempo - liderazgo relativo y absoluto juntos.
          </p>
        </div>
        <div style={infoSectionStyle}>
          <div style={{ ...infoTermStyle, color: BUCKET_ACCENT.persistencia }}>Persistencia / nuevos elegibles</div>
          <p style={infoTextStyle}>
            Liderazgo sostenido: score por encima del umbral varios días seguidos (evita alertar por un solo día
            de ruido). Nuevo elegible: un ticker recién alcanzó historial suficiente para tener score real.
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
}

function AlertRow({ alert, etfHoldings }: { alert: RelativeStrengthAlert; etfHoldings: EtfHoldingsMap }) {
  const color = ruleColor(alert.rule);
  return (
    <div style={alertRowStyle}>
      <EtfHoldingsTooltip ticker={alert.ticker} holdingsMap={etfHoldings}>
        <a href={finvizUrl(alert.ticker)} target="_blank" rel="noopener noreferrer" style={{
          backgroundColor: `${color}1a`,
          color,
          border: `1px solid ${color}40`,
          padding: '2px 7px',
          borderRadius: '4px',
          fontWeight: 800,
          fontSize: '0.7rem',
          fontFamily: 'monospace',
          flexShrink: 0,
          textDecoration: 'none',
          display: 'inline-block'
        }}>
          {alert.ticker}
        </a>
      </EtfHoldingsTooltip>
      <span style={{ fontSize: '0.76rem', color: 'rgba(255,255,255,0.8)', lineHeight: 1.4 }}>{alert.text}</span>
    </div>
  );
}

// Used for the 3 top-row columns (liderazgo/rotacion/confirmacion) - the
// grid slot is always rendered, even when empty, so the 3-column layout
// stays stable; emptiness shows as a "sin alertas" placeholder inside its
// own column instead of collapsing the grid.
function BucketColumn({ bucketKey, alerts, etfHoldings }: { bucketKey: BucketKey; alerts: RelativeStrengthAlert[]; etfHoldings: EtfHoldingsMap }) {
  const accent = BUCKET_ACCENT[bucketKey];
  return (
    <div style={{ ...bucketColumnStyle, borderColor: `${accent}25` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
        <h4 style={{ ...colHeaderStyle, color: accent, margin: 0 }}>{BUCKET_LABELS[bucketKey].toUpperCase()}</h4>
        <span style={{
          fontSize: '0.62rem',
          fontWeight: 700,
          color: accent,
          backgroundColor: `${accent}15`,
          border: `1px solid ${accent}30`,
          borderRadius: '10px',
          padding: '1px 7px'
        }}>
          {alerts.length}
        </span>
      </div>
      {alerts.length === 0 ? (
        <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.3)', padding: '8px 2px' }}>Sin alertas hoy</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {alerts.map(a => <AlertRow key={a.id} alert={a} etfHoldings={etfHoldings} />)}
        </div>
      )}
    </div>
  );
}

// Used for the persistencia strip below the 3-column row - stays hidden
// entirely when empty (unlike BucketColumn), same honest-signal behavior
// as the original single-list design.
function BucketStrip({ bucketKey, alerts, etfHoldings }: { bucketKey: BucketKey; alerts: RelativeStrengthAlert[]; etfHoldings: EtfHoldingsMap }) {
  if (alerts.length === 0) return null;
  const accent = BUCKET_ACCENT[bucketKey];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <h4 style={{ ...colHeaderStyle, color: accent, margin: 0 }}>{BUCKET_LABELS[bucketKey].toUpperCase()}</h4>
        <span style={{
          fontSize: '0.62rem',
          fontWeight: 700,
          color: accent,
          backgroundColor: `${accent}15`,
          border: `1px solid ${accent}30`,
          borderRadius: '10px',
          padding: '1px 7px'
        }}>
          {alerts.length}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {alerts.map(a => <AlertRow key={a.id} alert={a} etfHoldings={etfHoldings} />)}
      </div>
    </div>
  );
}

export default function RelativeStrengthAlertsPanel({ data, loading, etfHoldings }: RelativeStrengthAlertsPanelProps) {
  const [showInfo, setShowInfo] = useState(false);

  if (loading) {
    return (
      <div style={panelContainerStyle}>
        <div style={topGlowBarStyle} />
        <div style={headerStyle}>
          <Radar size={18} style={{ color: '#a78bfa', filter: 'drop-shadow(0 0 6px rgba(167,139,250,0.5))' }} />
          <h3 style={titleStyle}>ALERTAS DE FUERZA RELATIVA</h3>
        </div>
        <div style={loadingContainerStyle}>
          <div className="animate-pulse" style={loadingTextStyle}>Evaluando reglas de Fuerza Relativa...</div>
        </div>
      </div>
    );
  }

  if (!data || !data.date) {
    return (
      <div style={panelContainerStyle}>
        <div style={topGlowBarStyle} />
        <div style={headerStyle}>
          <Radar size={18} style={{ color: '#a78bfa', filter: 'drop-shadow(0 0 6px rgba(167,139,250,0.5))' }} />
          <h3 style={titleStyle}>ALERTAS DE FUERZA RELATIVA</h3>
        </div>
        <div style={errorContainerStyle}>
          <AlertCircle size={24} style={{ color: 'rgba(255,255,255,0.2)' }} />
          <div style={errorTitleStyle}>Sin datos todavía</div>
          <div style={errorDescStyle}>
            Este panel se completa con la primera corrida de <code>npm run rs:alerts:daily</code> (requiere que
            <code> rs:daily</code> haya corrido antes).
          </div>
        </div>
      </div>
    );
  }

  const totalCount = BUCKET_ORDER.reduce((sum, k) => sum + data.buckets[k].length, 0);

  return (
    <div style={panelContainerStyle}>
      <div style={topGlowBarStyle} />
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Radar size={18} style={{ color: '#a78bfa', filter: 'drop-shadow(0 0 6px rgba(167,139,250,0.5))' }} />
          <h3 style={titleStyle}>ALERTAS DE FUERZA RELATIVA</h3>
          <button onClick={() => setShowInfo(true)} style={infoButtonStyle} aria-label="¿Qué significan estos datos?">
            <Info size={13} />
          </button>
        </div>
        <span style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.4)' }}>al {data.date}</span>
      </div>

      {totalCount === 0 ? (
        <div style={{ padding: '18px 4px', textAlign: 'center', fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)' }}>
          Sin alertas hoy - ninguna de las 8 reglas disparó.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={columnsRowStyle}>
            {COLUMN_BUCKETS.map(key => (
              <BucketColumn key={key} bucketKey={key} alerts={data.buckets[key]} etfHoldings={etfHoldings} />
            ))}
          </div>
          <BucketStrip bucketKey="persistencia" alerts={data.buckets.persistencia} etfHoldings={etfHoldings} />
        </div>
      )}

      {showInfo && <AlertsInfoModal onClose={() => setShowInfo(false)} />}
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

const colHeaderStyle: React.CSSProperties = {
  fontSize: '0.68rem',
  fontWeight: 800,
  letterSpacing: '0.08em'
};

const columnsRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: '12px',
  alignItems: 'stretch',
  flexWrap: 'wrap'
};

const bucketColumnStyle: React.CSSProperties = {
  flex: '1 1 0',
  minWidth: '220px',
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  backgroundColor: 'rgba(255,255,255,0.015)',
  border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: '10px',
  padding: '10px 10px 12px'
};

const alertRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '8px',
  padding: '5px 8px',
  borderRadius: '6px',
  backgroundColor: 'rgba(255,255,255,0.02)'
};

const loadingContainerStyle: React.CSSProperties = {
  height: '160px',
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
