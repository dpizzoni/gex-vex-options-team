import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface EtfHoldingEntry {
  ticker: string;
  name: string;
  weight: number;
}

export interface EtfHoldingsInfo {
  name: string;
  holdings: EtfHoldingEntry[];
}

export type EtfHoldingsMap = Record<string, EtfHoldingsInfo>;

interface EtfHoldingsTooltipProps {
  ticker: string;
  holdingsMap: EtfHoldingsMap;
  children: React.ReactNode;
}

// Wraps any ticker element (FundFlowPanel's sector labels, RelativeStrengthPanel's
// ranking rows) with a hover tooltip showing that ETF's top-10 holdings, sourced
// from cache/etf-holdings.json (Yahoo Finance topHoldings, refreshed ~monthly -
// see scripts/fetch-etf-holdings.js). No "ver más" by design - Yahoo only ever
// returns the top 10, and that's all this tooltip promises. Tickers with no
// holdings data (e.g. GLD - physical gold, not an equity basket) render their
// children plain, with no hover affordance at all, rather than an empty tooltip.
export default function EtfHoldingsTooltip({ ticker, holdingsMap, children }: EtfHoldingsTooltipProps) {
  const [hovered, setHovered] = useState(false);
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  const info = holdingsMap[ticker];
  if (!info || info.holdings.length === 0) {
    return <>{children}</>;
  }

  const handleEnter = () => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (rect) setCoords({ x: rect.left + rect.width / 2, y: rect.top });
    setHovered(true);
  };

  return (
    <span
      ref={wrapperRef}
      onMouseEnter={handleEnter}
      onMouseLeave={() => setHovered(false)}
      style={{ cursor: 'help', borderBottom: '1px dotted rgba(167,139,250,0.4)' }}
    >
      {children}
      {hovered && coords && createPortal(
        <div
          style={{
            position: 'fixed',
            left: Math.min(Math.max(coords.x, 130), window.innerWidth - 130),
            top: coords.y,
            transform: 'translate(-50%, calc(-100% - 10px))',
            zIndex: 2000,
            pointerEvents: 'none'
          }}
        >
          <div style={tooltipBoxStyle}>
            <div style={tooltipHeaderStyle}>{info.name}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {info.holdings.map(h => (
                <div key={h.ticker} style={tooltipRowStyle}>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#a78bfa', minWidth: '46px' }}>{h.ticker}</span>
                  <span style={{ flex: 1, color: 'rgba(255,255,255,0.65)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.name}</span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#e2e8f0' }}>{h.weight.toFixed(2)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}
    </span>
  );
}

const tooltipBoxStyle: React.CSSProperties = {
  backgroundColor: 'rgba(10, 16, 35, 0.97)',
  border: '1px solid #a78bfa',
  borderRadius: '8px',
  padding: '8px 10px',
  width: '260px',
  boxShadow: '0 8px 24px rgba(0,0,0,0.5)'
};

const tooltipHeaderStyle: React.CSSProperties = {
  fontSize: '0.68rem',
  fontWeight: 800,
  color: '#fff',
  marginBottom: '6px',
  paddingBottom: '5px',
  borderBottom: '1px solid rgba(255,255,255,0.1)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis'
};

const tooltipRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontSize: '0.68rem'
};
