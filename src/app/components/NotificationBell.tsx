"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Bell } from 'lucide-react';

interface RegimeAlert {
  id: string;
  ticker: string;
  date: string;
  type: 'LONG_GAMMA_ENTRY' | 'SHORT_GAMMA_ENTRY';
  net_gex: number;
  ema3_net_gex: number;
  spot: number;
}

const READ_KEY = 'regimeAlerts_readIds';

export default function NotificationBell() {
  const [alerts, setAlerts] = useState<RegimeAlert[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/regime-alerts')
      .then(res => res.json())
      .then(data => {
        const sorted = (data.alerts || []).slice().sort((a: RegimeAlert, b: RegimeAlert) => b.date.localeCompare(a.date));
        setAlerts(sorted);
      })
      .catch(() => {});

    try {
      const stored = localStorage.getItem(READ_KEY);
      if (stored) setReadIds(new Set(JSON.parse(stored)));
    } catch (e) {
      // ignore malformed localStorage state
    }
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const unreadCount = alerts.filter(a => !readIds.has(a.id)).length;

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next && unreadCount > 0) {
      const allIds = new Set([...Array.from(readIds), ...alerts.map(a => a.id)]);
      setReadIds(allIds);
      try {
        localStorage.setItem(READ_KEY, JSON.stringify(Array.from(allIds)));
      } catch (e) {
        // ignore write failures (e.g. storage disabled)
      }
    }
  };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button onClick={handleToggle} style={bellButtonStyle} aria-label="Notificaciones de cambio de régimen">
        <Bell size={16} color={unreadCount > 0 ? '#fbbf24' : '#a1a1aa'} />
        {unreadCount > 0 && (
          <span style={badgeStyle}>{unreadCount > 9 ? '9+' : unreadCount}</span>
        )}
      </button>

      {open && (
        <div style={dropdownStyle}>
          <div style={dropdownHeaderStyle}>Cambios de régimen</div>
          <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
            {alerts.length === 0 ? (
              <div style={emptyStyle}>Sin alertas por ahora.</div>
            ) : (
              alerts.map(a => (
                <div key={a.id} style={alertItemStyle}>
                  <div style={{ fontWeight: 700, fontSize: '0.8rem', color: a.type === 'LONG_GAMMA_ENTRY' ? '#00e676' : '#ff2a6d' }}>
                    {a.ticker} → {a.type === 'LONG_GAMMA_ENTRY' ? 'LONG GAMMA' : 'SHORT GAMMA'}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)', marginTop: '2px' }}>
                    {a.date} · Spot ${a.spot.toFixed(2)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const bellButtonStyle: React.CSSProperties = {
  position: 'relative',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '8px',
  width: '30px',
  height: '30px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer'
};

const badgeStyle: React.CSSProperties = {
  position: 'absolute',
  top: '-5px',
  right: '-5px',
  backgroundColor: '#ff2a6d',
  color: '#fff',
  fontSize: '0.6rem',
  fontWeight: 800,
  borderRadius: '10px',
  minWidth: '15px',
  height: '15px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0 3px',
  lineHeight: 1
};

const dropdownStyle: React.CSSProperties = {
  position: 'absolute',
  top: '38px',
  right: 0,
  width: '280px',
  backgroundColor: 'rgba(10, 16, 35, 0.98)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '10px',
  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  zIndex: 200,
  overflow: 'hidden'
};

const dropdownHeaderStyle: React.CSSProperties = {
  padding: '10px 14px',
  fontSize: '0.75rem',
  fontWeight: 800,
  letterSpacing: '0.05em',
  color: '#a78bfa',
  borderBottom: '1px solid rgba(255,255,255,0.06)'
};

const alertItemStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderBottom: '1px solid rgba(255,255,255,0.04)'
};

const emptyStyle: React.CSSProperties = {
  padding: '20px 14px',
  fontSize: '0.75rem',
  color: 'rgba(255,255,255,0.4)',
  fontStyle: 'italic',
  textAlign: 'center'
};
