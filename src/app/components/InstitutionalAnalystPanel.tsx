import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bot, AlertCircle, Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';

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

const WEEKDAY_LABELS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

// Local (not UTC) Y-M-D so calendar cells match the `date` strings in history,
// which are plain YYYY-MM-DD with no time/timezone component.
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Mon-first 6-row grid for the given year/month, padded with adjacent-month
// days (rendered dim, non-interactive) so the grid is always a clean 6x7.
function buildMonthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7; // 0=Mon
  const gridStart = new Date(year, month, 1 - startOffset);
  return Array.from({ length: 42 }, (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
}

function HistoryCalendarModal({ history, initialDate, onSelect, onClose }: {
  history: InstitutionalAnalysisEntry[];
  initialDate: string;
  onSelect: (date: string) => void;
  onClose: () => void;
}) {
  const [y, m] = initialDate.split('-').map(Number);
  const [viewYear, setViewYear] = useState(y);
  const [viewMonth, setViewMonth] = useState(m - 1);

  const availableDates = useMemo(() => new Set(history.map(e => e.date)), [history]);
  const grid = useMemo(() => buildMonthGrid(viewYear, viewMonth), [viewYear, viewMonth]);

  const goMonth = (delta: number) => {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });

  // Portal to document.body: the panel ancestor uses backdrop-filter, which
  // creates its own stacking context - without a portal this fixed-position
  // overlay gets trapped inside it and renders behind later sibling panels
  // (e.g. Fund Flow) instead of on top of the whole page.
  return createPortal(
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <div style={modalHeaderStyle}>
          <span style={{ fontWeight: 800, fontSize: '0.9rem', color: '#a78bfa', textTransform: 'capitalize' }}>{monthLabel}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button onClick={() => goMonth(-1)} style={iconButtonStyle} aria-label="Mes anterior"><ChevronLeft size={16} /></button>
            <button onClick={() => goMonth(1)} style={iconButtonStyle} aria-label="Mes siguiente"><ChevronRight size={16} /></button>
            <button onClick={onClose} style={{ ...iconButtonStyle, marginLeft: '8px' }} aria-label="Cerrar"><X size={16} /></button>
          </div>
        </div>

        <div style={weekdayRowStyle}>
          {WEEKDAY_LABELS.map(w => <span key={w} style={weekdayLabelStyle}>{w}</span>)}
        </div>

        <div style={calendarGridStyle}>
          {grid.map(d => {
            const dateStr = ymd(d);
            const inMonth = d.getMonth() === viewMonth;
            const hasEntry = availableDates.has(dateStr);
            return (
              <button
                key={dateStr}
                disabled={!hasEntry}
                onClick={() => hasEntry && onSelect(dateStr)}
                style={{
                  ...dayCellStyle,
                  opacity: inMonth ? 1 : 0.25,
                  cursor: hasEntry ? 'pointer' : 'default',
                  backgroundColor: hasEntry ? 'rgba(167,139,250,0.16)' : 'transparent',
                  color: hasEntry ? '#e9e4ff' : 'rgba(255,255,255,0.4)',
                  fontWeight: hasEntry ? 700 : 400,
                  border: hasEntry ? '1px solid rgba(167,139,250,0.4)' : '1px solid transparent'
                }}
              >
                {d.getDate()}
              </button>
            );
          })}
        </div>

        <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.35)', textAlign: 'center' }}>
          Los días resaltados tienen análisis disponible.
        </div>
      </div>
    </div>,
    document.body
  );
}

function AnalysisDayModal({ entry, onClose }: { entry: InstitutionalAnalysisEntry; onClose: () => void }) {
  return createPortal(
    <div style={overlayStyle} onClick={onClose}>
      <div style={{ ...modalStyle, maxWidth: '520px' }} onClick={e => e.stopPropagation()}>
        <div style={modalHeaderStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Bot size={16} style={{ color: '#a78bfa' }} />
            <span style={{ fontWeight: 800, fontSize: '0.9rem' }}>{entry.date}</span>
            <span style={modelBadgeStyle}>{entry.model}</span>
          </div>
          <button onClick={onClose} style={iconButtonStyle} aria-label="Cerrar"><X size={16} /></button>
        </div>
        <p style={narrativeStyle}>{entry.narrative}</p>
      </div>
    </div>,
    document.body
  );
}

export default function InstitutionalAnalystPanel({ history, loading }: InstitutionalAnalystPanelProps) {
  const [showCalendar, setShowCalendar] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

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
  const selectedEntry = selectedDate ? history.find(e => e.date === selectedDate) ?? null : null;

  return (
    <div style={panelContainerStyle}>
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Bot size={18} style={{ color: '#a78bfa' }} />
          <h3 style={titleStyle}>INSTITUTIONAL ANALYST</h3>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)' }}>al {latest.date}</span>
          <button onClick={() => setShowCalendar(true)} style={historyToggleStyle} title="Ver historial">
            <Calendar size={14} />
            Historial
          </button>
        </div>
      </div>

      <p style={narrativeStyle}>{latest.narrative}</p>

      {showCalendar && (
        <HistoryCalendarModal
          history={history}
          initialDate={latest.date}
          onSelect={date => { setSelectedDate(date); setShowCalendar(false); }}
          onClose={() => setShowCalendar(false)}
        />
      )}

      {selectedEntry && (
        <AnalysisDayModal entry={selectedEntry} onClose={() => setSelectedDate(null)} />
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
  background: 'rgba(167,139,250,0.1)',
  border: '1px solid rgba(167,139,250,0.3)',
  borderRadius: '20px',
  color: '#a78bfa',
  fontSize: '0.7rem',
  fontWeight: 700,
  cursor: 'pointer',
  padding: '4px 10px'
};

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000
};

const modalStyle: React.CSSProperties = {
  backgroundColor: '#0a1023',
  border: '1px solid rgba(167,139,250,0.3)',
  borderRadius: '14px',
  padding: '20px',
  width: '340px',
  maxWidth: '90vw',
  maxHeight: '85vh',
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: '14px',
  boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
  color: '#fff'
};

const modalHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between'
};

const iconButtonStyle: React.CSSProperties = {
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

const weekdayRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(7, 1fr)',
  gap: '4px'
};

const weekdayLabelStyle: React.CSSProperties = {
  fontSize: '0.65rem',
  fontWeight: 700,
  color: 'rgba(255,255,255,0.35)',
  textAlign: 'center'
};

const calendarGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(7, 1fr)',
  gap: '4px'
};

const dayCellStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  borderRadius: '6px',
  padding: '6px 0',
  textAlign: 'center'
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
