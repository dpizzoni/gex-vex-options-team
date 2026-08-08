import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bot, AlertCircle, Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';

export interface InstitutionalAnalysisEntry {
  date: string;
  narrative: string;
  generated_at: string;
}

interface InstitutionalAnalystPanelProps {
  history: InstitutionalAnalysisEntry[];
  loading: boolean;
  onClose?: () => void;
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

function AnalysisDayModal({ entry, onClose, onPrev, onNext }: { entry: InstitutionalAnalysisEntry; onClose: () => void; onPrev?: () => void; onNext?: () => void }) {
  return createPortal(
    <div style={overlayStyle} onClick={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', maxWidth: '100vw', padding: '0 10px' }} onClick={e => e.stopPropagation()}>
        
        {/* Left Arrow */}
        <button 
          disabled={!onPrev} 
          onClick={onPrev} 
          style={{ ...iconButtonStyle, opacity: onPrev ? 1 : 0, pointerEvents: onPrev ? 'auto' : 'none', cursor: 'pointer', width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0, background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.3)' }} 
          aria-label="Fecha anterior"
        >
          <ChevronLeft size={20} color="#a78bfa" />
        </button>

        {/* Modal Content */}
        <div style={{ ...modalStyle, maxWidth: '560px', width: '100vw', flex: 1 }}>
          <div style={modalHeaderStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Bot size={16} style={{ color: '#a78bfa' }} />
              <span style={{ fontWeight: 800, fontSize: '0.9rem' }}>{entry.date}</span>
            </div>
            <button onClick={onClose} style={iconButtonStyle} aria-label="Cerrar"><X size={16} /></button>
          </div>
          <p style={narrativeStyle}>{entry.narrative}</p>
        </div>

        {/* Right Arrow */}
        <button 
          disabled={!onNext} 
          onClick={onNext} 
          style={{ ...iconButtonStyle, opacity: onNext ? 1 : 0, pointerEvents: onNext ? 'auto' : 'none', cursor: 'pointer', width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0, background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.3)' }} 
          aria-label="Fecha siguiente"
        >
          <ChevronRight size={20} color="#a78bfa" />
        </button>

      </div>
    </div>,
    document.body
  );
}

export default function InstitutionalAnalystPanel({ history, loading, onClose }: InstitutionalAnalystPanelProps) {
  const [showCalendar, setShowCalendar] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  if (loading) {
    return (
      <div style={panelContainerStyle}>
        <div style={topGlowBarStyle} />
        <div style={headerStyle}>
          <Bot size={18} style={{ color: '#a78bfa', filter: 'drop-shadow(0 0 6px rgba(167,139,250,0.5))' }} />
          <h3 style={titleStyle}>INSTITUTIONAL ANALYST</h3>
          {onClose && (
            <button onClick={onClose} style={iconButtonStyle} aria-label="Cerrar"><X size={16} /></button>
          )}
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
        <div style={topGlowBarStyle} />
        <div style={headerStyle}>
          <Bot size={18} style={{ color: '#a78bfa', filter: 'drop-shadow(0 0 6px rgba(167,139,250,0.5))' }} />
          <h3 style={titleStyle}>INSTITUTIONAL ANALYST</h3>
          {onClose && (
            <button onClick={onClose} style={iconButtonStyle} aria-label="Cerrar"><X size={16} /></button>
          )}
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
      <div style={topGlowBarStyle} />
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Bot size={18} style={{ color: '#a78bfa', filter: 'drop-shadow(0 0 6px rgba(167,139,250,0.5))' }} />
          <h3 style={titleStyle}>INSTITUTIONAL ANALYST</h3>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>al {latest.date}</span>
          <button onClick={() => setShowCalendar(true)} style={historyToggleStyle} title="Ver historial">
            <Calendar size={13} />
            Historial
          </button>
          {onClose && (
            <button onClick={onClose} style={iconButtonStyle} aria-label="Cerrar"><X size={16} /></button>
          )}
        </div>
      </div>

      <div style={briefingBoxStyle}>
        <p style={narrativeStyle}>{latest.narrative}</p>
      </div>

      <div style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.35)', textAlign: 'right', marginTop: 'auto', paddingTop: '2px' }}>
        análisis cuantitativo del mercado
      </div>

      {showCalendar && (
        <HistoryCalendarModal
          history={history}
          initialDate={latest.date}
          onSelect={date => { setSelectedDate(date); setShowCalendar(false); }}
          onClose={() => setShowCalendar(false)}
        />
      )}

      {selectedEntry && (() => {
        const selectedIndex = sorted.findIndex(e => e.date === selectedEntry.date);
        const onPrev = selectedIndex < sorted.length - 1 ? () => setSelectedDate(sorted[selectedIndex + 1].date) : undefined;
        const onNext = selectedIndex > 0 ? () => setSelectedDate(sorted[selectedIndex - 1].date) : undefined;
        return (
          <AnalysisDayModal 
            entry={selectedEntry} 
            onClose={() => setSelectedDate(null)} 
            onPrev={onPrev}
            onNext={onNext}
          />
        );
      })()}
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
  backgroundColor: '#0d1426',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'rgba(255, 255, 255, 0.08)',
  borderRadius: '14px',
  padding: '16px',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  backdropFilter: 'blur(16px)',
  boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.36)',
  color: '#fff',
  maxHeight: '100%',
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

const briefingBoxStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.16)',
  border: '1px solid rgba(255, 255, 255, 0.04)',
  borderLeft: '3px solid #a78bfa',
  borderRadius: '10px',
  padding: '14px',
  overflowY: 'auto'
};

const narrativeStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.84rem',
  lineHeight: 1.7,
  color: '#e2e8f0',
  whiteSpace: 'pre-line'
};

const historyToggleStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '5px',
  background: 'rgba(167,139,250,0.1)',
  border: '1px solid rgba(167,139,250,0.3)',
  borderRadius: '20px',
  color: '#a78bfa',
  fontSize: '0.68rem',
  fontWeight: 700,
  cursor: 'pointer',
  padding: '4px 10px',
  transition: 'all 0.2s ease'
};

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(0,0,0,0.65)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10000,
  backdropFilter: 'blur(4px)'
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
