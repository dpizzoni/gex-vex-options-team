import React, { useState } from 'react';
import { RegimeHistoryEntry, ForwardExpirationEntry } from '@/lib/gamma-regime-engine';

interface GammaRegimeChartProps {
  history: RegimeHistoryEntry[];
  forwardExpirations: ForwardExpirationEntry[];
  symbol: string;
  putWall?: number | null;
  callWall?: number | null;
  limitedForwardData?: boolean;
}

export default function GammaRegimeChart({ history, forwardExpirations, symbol, putWall, callWall, limitedForwardData }: GammaRegimeChartProps) {
  const [hoveredData, setHoveredData] = useState<{
    x: number;
    y: number;
    label: string;
    value1: string; // GEX
    value1Color?: string;
    value2?: string; // Spot / DTE+Regime
    extraLines?: string[];
  } | null>(null);
  const [showStabilityInfo, setShowStabilityInfo] = useState(false);

  if (!history || history.length === 0) {
    return (
      <div style={containerStyle}>
        <div style={noDataStyle}>No hay historial disponible para graficar.</div>
      </div>
    );
  }

  // Combine dimensions
  const svgWidth = 800;
  const svgHeight = 350;

  const paddingLeft = 65;
  // Widened to fit the forward-only price axis (callWall/spot/putWall) alongside
  // the existing past-only spot axis without the two overlapping.
  const paddingRight = 95;
  const paddingTop = 30;
  const paddingBottom = 40;

  const chartWidth = svgWidth - paddingLeft - paddingRight;
  const chartHeight = svgHeight - paddingTop - paddingBottom;

  // Stability panel sub-height
  const stabilityHeight = 40;
  const mainChartHeight = chartHeight - stabilityHeight - 15;

  // The regime engine needs the full history for its rolling calculations, but the
  // chart only has room to draw a limited window of bars (like the UW reference chart).
  const DISPLAY_DAYS = 30;
  const displayStartIndex = Math.max(0, history.length - DISPLAY_DAYS);
  const displayHistory = history.slice(displayStartIndex);

  const pastCount = displayHistory.length;
  const forwardCount = forwardExpirations.length;
  const totalPeriods = pastCount + forwardCount;

  const colWidth = chartWidth / totalPeriods;

  // Calculate scales for GEX (Left Y Axis).
  // Past (UW daily aggregate GEX across all open contracts) and forward (UW per-expiry
  // GEX for that expiration only) are both real UW data now, but different aggregation
  // granularities that aren't guaranteed to share a magnitude, so each still gets its
  // own independent vertical scale within the shared chart height.
  const maxAbsGexPast = Math.max(...displayHistory.map(h => Math.abs(h.net_gex)), 100000);
  const maxAbsGexForward = Math.max(...forwardExpirations.map(f => Math.abs(f.net_gex)), 100000);
  const maxAbsGex = maxAbsGexPast; // left axis labels reflect the past scale

  const getGexY = (val: number) => {
    const centerY = paddingTop + mainChartHeight / 2;
    const scale = (mainChartHeight / 2) / maxAbsGexPast;
    return centerY - val * scale;
  };
  const getGexYForward = (val: number) => {
    const centerY = paddingTop + mainChartHeight / 2;
    const scale = (mainChartHeight / 2) / maxAbsGexForward;
    return centerY - val * scale;
  };

  // Calculate scales for Spot (Right Y Axis - history only)
  const spotValues = displayHistory.map(h => h.spot);
  const minSpot = Math.min(...spotValues) * 0.99;
  const maxSpot = Math.max(...spotValues) * 1.01;
  const getSpotY = (val: number) => {
    const height = mainChartHeight;
    const scale = height / (maxSpot - minSpot);
    return paddingTop + height - (val - minSpot) * scale;
  };

  // Forward-only price axis: 3 fixed ticks (callWall / spot / putWall) instead of a
  // continuous line, since forward bars are per-expiration structure, not a price series.
  const hasForwardPriceRange = putWall != null && callWall != null && callWall > putWall;
  const forwardSpot = displayHistory.length > 0 ? displayHistory[displayHistory.length - 1].spot : null;
  const getForwardPriceY = (price: number) => {
    if (!hasForwardPriceRange) return paddingTop + mainChartHeight / 2;
    const range = (callWall as number) - (putWall as number);
    return paddingTop + mainChartHeight - ((price - (putWall as number)) / range) * mainChartHeight;
  };

  // Stability Score rolling 20d, computed over the full history (so early displayed
  // days still have correct lookback), then sliced down to the display window.
  const fullStabilityData = history.map((entry, idx) => {
    if (idx < 19) return 0; // need 20 days
    const subset = history.slice(idx - 19, idx + 1);
    const currentRegime = entry.ema3_net_gex >= 0 ? "LONG" : "SHORT";
    let sameRegimeCount = 0;
    subset.forEach(h => {
      const hRegime = h.ema3_net_gex >= 0 ? "LONG" : "SHORT";
      if (hRegime === currentRegime) sameRegimeCount++;
    });
    return sameRegimeCount / 20;
  });
  const stabilityData = fullStabilityData.slice(displayStartIndex);

  const getStabilityY = (score: number) => {
    const base = svgHeight - paddingBottom;
    return base - score * stabilityHeight;
  };

  // Helper to format values
  const formatGexAbbrev = (val: number) => {
    const absVal = Math.abs(val);
    const sign = val < 0 ? "-" : "";
    if (absVal >= 1.0e6) return `${sign}${(absVal / 1.0e6).toFixed(1)}M`;
    if (absVal >= 1.0e3) return `${sign}${(absVal / 1.0e3).toFixed(0)}K`;
    return `${sign}${absVal.toFixed(0)}`;
  };

  // Generate Spot Line Path
  let spotPath = "";
  displayHistory.forEach((h, idx) => {
    const x = paddingLeft + idx * colWidth + colWidth / 2;
    const y = getSpotY(h.spot);
    if (idx === 0) spotPath += `M ${x} ${y}`;
    else spotPath += ` L ${x} ${y}`;
  });

  // Generate EMA3 Line Path
  let emaPath = "";
  displayHistory.forEach((h, idx) => {
    const x = paddingLeft + idx * colWidth + colWidth / 2;
    const y = getGexY(h.ema3_net_gex);
    if (idx === 0) emaPath += `M ${x} ${y}`;
    else emaPath += ` L ${x} ${y}`;
  });

  // Generate Stability Line Path (already has valid rolling lookback for every displayed day)
  let stabilityPath = "";
  stabilityData.forEach((score, idx) => {
    const x = paddingLeft + idx * colWidth + colWidth / 2;
    const y = getStabilityY(score);
    if (idx === 0) stabilityPath += `M ${x} ${y}`;
    else stabilityPath += ` L ${x} ${y}`;
  });

  // Find regime shifts for vertical marker lines (within the displayed window).
  // Uses the same sign as the bar coloring (raw net_gex, not EMA3) so the dotted
  // line lands exactly where the bar color changes.
  const shifts: { x: number; label: string; date: string }[] = [];
  for (let i = 1; i < displayHistory.length; i++) {
    const prevRegime = displayHistory[i - 1].net_gex >= 0 ? "LONG" : "SHORT";
    const currRegime = displayHistory[i].net_gex >= 0 ? "LONG" : "SHORT";

    if (prevRegime !== currRegime) {
      const x = paddingLeft + i * colWidth;
      shifts.push({
        x,
        label: currRegime === "LONG" ? "Shift → LONG" : "Shift → SHORT",
        date: displayHistory[i].date
      });
    }
  }

  return (
    <div style={containerStyle}>
      <div style={titleStyle}>GAMMA REGIME CHART ({symbol})</div>
      
      <div style={{ position: 'relative' }}>
        <svg width="100%" height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`} style={svgStyle}>
          {/* Patterns for Forward Stripes */}
          <defs>
            <pattern id="stripe-green" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="#00e676" strokeWidth="1.5" opacity="0.6" />
            </pattern>
            <pattern id="stripe-red" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="#ff2a6d" strokeWidth="1.5" opacity="0.6" />
            </pattern>
          </defs>

          {/* Grid lines & Y Left Axes */}
          <line x1={paddingLeft} y1={paddingTop} x2={paddingLeft} y2={paddingTop + mainChartHeight} stroke="rgba(255,255,255,0.15)" />
          <line x1={svgWidth - paddingRight} y1={paddingTop} x2={svgWidth - paddingRight} y2={paddingTop + mainChartHeight} stroke="rgba(255,255,255,0.15)" />

          {/* Zero GEX line */}
          <line 
            x1={paddingLeft} 
            y1={getGexY(0)} 
            x2={svgWidth - paddingRight} 
            y2={getGexY(0)} 
            stroke="rgba(255,255,255,0.25)" 
            strokeDasharray="3,3" 
          />

          {/* Y-Axis Labels Left (GEX) */}
          <text x={paddingLeft - 8} y={getGexY(maxAbsGex) + 4} fill="#a1a1aa" fontSize="10" textAnchor="end" fontFamily="monospace">
            {formatGexAbbrev(maxAbsGex)}
          </text>
          <text x={paddingLeft - 8} y={getGexY(0) + 4} fill="#a1a1aa" fontSize="10" textAnchor="end" fontFamily="monospace">
            0
          </text>
          <text x={paddingLeft - 8} y={getGexY(-maxAbsGex) + 4} fill="#a1a1aa" fontSize="10" textAnchor="end" fontFamily="monospace">
            {formatGexAbbrev(-maxAbsGex)}
          </text>
          <text x={14} y={paddingTop + mainChartHeight / 2} fill="#a78bfa" fontSize="9" fontWeight="bold" transform={`rotate(-90, 14, ${paddingTop + mainChartHeight/2})`} textAnchor="middle">
            NET GEX
          </text>

          {/* Y-Axis Labels Right (Spot - history) */}
          <text x={svgWidth - paddingRight + 8} y={getSpotY(maxSpot) + 4} fill="#fbbf24" fontSize="10" textAnchor="start" fontFamily="monospace">
            ${maxSpot.toFixed(0)}
          </text>
          <text x={svgWidth - paddingRight + 8} y={getSpotY((minSpot+maxSpot)/2) + 4} fill="#fbbf24" fontSize="10" textAnchor="start" fontFamily="monospace">
            ${((minSpot+maxSpot)/2).toFixed(0)}
          </text>
          <text x={svgWidth - paddingRight + 8} y={getSpotY(minSpot) + 4} fill="#fbbf24" fontSize="10" textAnchor="start" fontFamily="monospace">
            ${minSpot.toFixed(0)}
          </text>
          <text x={svgWidth - paddingRight + 42} y={paddingTop + mainChartHeight / 2} fill="#fbbf24" fontSize="9" fontWeight="bold" transform={`rotate(90, ${svgWidth - paddingRight + 42}, ${paddingTop + mainChartHeight/2})`} textAnchor="middle">
            SPOT
          </text>

          {/* Vertical Separator Line between Past and Forward */}
          <line 
            x1={paddingLeft + pastCount * colWidth} 
            y1={paddingTop - 10} 
            x2={paddingLeft + pastCount * colWidth} 
            y2={svgHeight - paddingBottom} 
            stroke="#fbbf24" 
            strokeWidth="1.5"
            strokeDasharray="4,4" 
          />
          
          {/* Separator Labels */}
          <text x={paddingLeft + pastCount * colWidth - 8} y={paddingTop - 6} fill="#cbd5e1" fontSize="9" fontWeight="bold" textAnchor="end">
            PASADO CONFIRMADO
          </text>
          <text x={paddingLeft + pastCount * colWidth + 8} y={paddingTop - 6} fill="#a78bfa" fontSize="9" fontWeight="bold" textAnchor="start">
            FORWARD STRUCTURE (UW)
          </text>
          {limitedForwardData && forwardCount > 0 && (
            <text x={paddingLeft + pastCount * colWidth + 8} y={paddingTop + 22} fill="#fbbf24" fontSize="8" fontStyle="italic" textAnchor="start">
              (datos forward limitados)
            </text>
          )}

          {/* FORWARD-ONLY PRICE AXIS: callWall / spot / putWall (3 fixed ticks) */}
          {hasForwardPriceRange && forwardCount > 0 && (
            <g>
              <line
                x1={paddingLeft + pastCount * colWidth}
                y1={getForwardPriceY(forwardSpot ?? (callWall as number))}
                x2={svgWidth - paddingRight}
                y2={getForwardPriceY(forwardSpot ?? (callWall as number))}
                stroke="#fbbf24"
                strokeWidth="1"
                strokeDasharray="3,3"
                opacity={0.7}
              />
              <text x={svgWidth - 4} y={getForwardPriceY(callWall as number) + 4} fill="#fbbf24" fontSize="9" textAnchor="end" fontFamily="monospace">
                ${(callWall as number).toFixed(0)}
              </text>
              {forwardSpot != null && (
                <text x={svgWidth - 4} y={getForwardPriceY(forwardSpot) + 4} fill="#fbbf24" fontSize="9" textAnchor="end" fontFamily="monospace">
                  ${forwardSpot.toFixed(0)}
                </text>
              )}
              <text x={svgWidth - 4} y={getForwardPriceY(putWall as number) + 4} fill="#fbbf24" fontSize="9" textAnchor="end" fontFamily="monospace">
                ${(putWall as number).toFixed(0)}
              </text>
            </g>
          )}

          {/* BACKGROUND SHADING FOR EXPLOSIVE ACCELERATION / FRAGILE PIN IN PAST */}
          {displayHistory.map((h, idx) => {
            // Estimate if it was Pin Fragil or Aceleracion Explosiva based on GEX and VEX
            const isVexHigh = Math.abs(h.net_vex) / Math.max(Math.abs(h.net_gex), 1e-4) > 0.20;
            if (isVexHigh) {
              const isLong = h.ema3_net_gex >= 0;
              const x = paddingLeft + idx * colWidth;
              return (
                <rect 
                  key={`shading-${idx}`}
                  x={x}
                  y={paddingTop}
                  width={colWidth}
                  height={mainChartHeight}
                  fill={isLong ? "rgba(0, 230, 118, 0.04)" : "rgba(255, 42, 109, 0.04)"}
                />
              );
            }
            return null;
          })}

          {/* GEX BARS - PAST (SOLID) */}
          {displayHistory.map((h, idx) => {
            const x = paddingLeft + idx * colWidth + 2;
            const w = Math.max(1, colWidth - 4);
            const val = h.net_gex;
            const y0 = getGexY(0);
            const y = getGexY(val);
            const isPositive = val >= 0;
            const barHeight = Math.abs(y0 - y);
            const barY = val >= 0 ? y : y0;

            return (
              <rect
                key={`bar-past-${idx}`}
                x={x}
                y={barY}
                width={w}
                height={Math.max(1, barHeight)}
                fill={isPositive ? "#00e676" : "#ff2a6d"}
                opacity={0.8}
                onMouseEnter={(e) => {
                  setHoveredData({
                    x: x + w / 2,
                    y: barY,
                    label: `Fecha: ${h.date}`,
                    value1: `Net GEX: ${formatGexAbbrev(val)}`,
                    value1Color: isPositive ? "#00e676" : "#ff2a6d",
                    value2: `Spot: $${h.spot.toFixed(2)}`
                  });
                }}
                onMouseLeave={() => setHoveredData(null)}
                style={{ cursor: 'pointer' }}
              />
            );
          })}

          {/* GEX BARS - FORWARD (STRIPED / PATTERNED) */}
          {forwardExpirations.map((f, idx) => {
            const index = pastCount + idx;
            const x = paddingLeft + index * colWidth + 2;
            const w = Math.max(1, colWidth - 4);
            const val = f.net_gex;
            const y0 = getGexYForward(0);
            const y = getGexYForward(val);
            const barHeight = Math.abs(y0 - y);
            const barY = val >= 0 ? y : y0;
            const isPos = val >= 0;

            return (
              <rect
                key={`bar-fwd-${idx}`}
                x={x}
                y={barY}
                width={w}
                height={Math.max(1, barHeight)}
                fill={isPos ? "url(#stripe-green)" : "url(#stripe-red)"}
                stroke={isPos ? "#00e676" : "#ff2a6d"}
                strokeWidth="0.5"
                onMouseEnter={(e) => {
                  setHoveredData({
                    x: x + w / 2,
                    y: barY,
                    label: `Expiración: ${f.expiration}`,
                    value1: `Net GEX: ${formatGexAbbrev(val)}`,
                    value1Color: isPos ? "#00e676" : "#ff2a6d",
                    value2: `DTE: ${f.dte ?? '-'}  |  ${isPos ? 'LONG_GAMMA' : 'SHORT_GAMMA'}`,
                    extraLines: [
                      `Call GEX: ${formatGexAbbrev(f.call_gex)}`,
                      `Put GEX: ${formatGexAbbrev(f.put_gex)}`
                    ]
                  });
                }}
                onMouseLeave={() => setHoveredData(null)}
                style={{ cursor: 'pointer' }}
              />
            );
          })}

          {/* Spot Line (Past only) */}
          <path 
            d={spotPath} 
            fill="none" 
            stroke="#fbbf24" 
            strokeWidth="2.5" 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            opacity={0.9}
          />

          {/* EMA3 Line (Past only) */}
          <path 
            d={emaPath} 
            fill="none" 
            stroke="#ffffff" 
            strokeWidth="1.5" 
            strokeDasharray="2,2" 
            opacity={0.8}
          />

          {/* REGIME SHIFT MARKERS */}
          {shifts.map((shift, idx) => (
            <g key={`shift-${idx}`}>
              <line 
                x1={shift.x} 
                y1={paddingTop} 
                x2={shift.x} 
                y2={paddingTop + mainChartHeight} 
                stroke="#fff" 
                strokeDasharray="2,4" 
                opacity="0.4"
              />
              <text 
                x={shift.x + 4} 
                y={paddingTop + 15 + (idx % 2) * 15} 
                fill="#fff" 
                fontSize="8" 
                fontWeight="bold"
                opacity="0.5"
              >
                {shift.label}
              </text>
            </g>
          ))}

          {/* STABILITY SCORE PANEL (SPARKLINE) */}
          {/* Label & Grid */}
          <line x1={paddingLeft} y1={svgHeight - paddingBottom} x2={svgWidth - paddingRight} y2={svgHeight - paddingBottom} stroke="rgba(255,255,255,0.15)" />
          <line x1={paddingLeft} y1={svgHeight - paddingBottom - stabilityHeight} x2={svgWidth - paddingRight} y2={svgHeight - paddingBottom - stabilityHeight} stroke="rgba(255,255,255,0.05)" />

          <text x={paddingLeft - 8} y={svgHeight - paddingBottom - 18} fill="#a1a1aa" fontSize="9" textAnchor="end">
            100%
          </text>
          <text x={paddingLeft - 8} y={svgHeight - paddingBottom - 2} fill="#a1a1aa" fontSize="9" textAnchor="end">
            0%
          </text>
          <text x={16} y={svgHeight - paddingBottom - stabilityHeight/2} fill="#c084fc" fontSize="8" fontWeight="bold" transform={`rotate(-90, 16, ${svgHeight - paddingBottom - stabilityHeight/2})`} textAnchor="middle">
            STABIL
          </text>

          {/* Info icon: toggles the Gamma Stability explanation popover */}
          <g
            transform={`translate(${paddingLeft + 4}, ${svgHeight - paddingBottom - stabilityHeight + 9})`}
            onClick={() => setShowStabilityInfo(v => !v)}
            style={{ cursor: 'pointer' }}
          >
            <circle r="6" fill="rgba(167, 139, 250, 0.15)" stroke="#a78bfa" strokeWidth="1" />
            <text x={0} y={3} fill="#a78bfa" fontSize="9" fontWeight="bold" textAnchor="middle" fontFamily="serif">i</text>
          </g>

          {/* Stability Line */}
          <path 
            d={stabilityPath} 
            fill="none" 
            stroke="#a78bfa" 
            strokeWidth="1.8" 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            opacity={0.8}
          />

          {/* X Axis Date Labels */}
          {/* Past labels (sample every 5 sessions) */}
          {displayHistory.map((h, idx) => {
            if (idx % 5 === 0 && idx < pastCount - 1) {
              const x = paddingLeft + idx * colWidth + colWidth / 2;
              return (
                <g key={`x-lbl-past-${idx}`}>
                  <line x1={x} y1={svgHeight - paddingBottom} x2={x} y2={svgHeight - paddingBottom + 4} stroke="rgba(255,255,255,0.3)" />
                  <text x={x} y={svgHeight - paddingBottom + 16} fill="#a1a1aa" fontSize="8" textAnchor="middle">
                    {h.date.substring(5)}
                  </text>
                </g>
              );
            }
            return null;
          })}

          {/* Forward labels (sampled so labels don't collide when there are many expirations) */}
          {(() => {
            const forwardLabelStep = Math.max(1, Math.ceil(forwardExpirations.length / 8));
            return forwardExpirations.map((f, idx) => {
              const index = pastCount + idx;
              const x = paddingLeft + index * colWidth + colWidth / 2;
              const showLabel = idx % forwardLabelStep === 0 || idx === forwardExpirations.length - 1;
              return (
                <g key={`x-lbl-fwd-${idx}`}>
                  <line x1={x} y1={svgHeight - paddingBottom} x2={x} y2={svgHeight - paddingBottom + 4} stroke="rgba(167, 139, 250, 0.4)" />
                  {showLabel && (
                    <text x={x} y={svgHeight - paddingBottom + 16} fill="#a78bfa" fontSize="8" fontWeight="bold" textAnchor="middle">
                      {f.expiration.substring(5)}
                    </text>
                  )}
                </g>
              );
            });
          })()}
        </svg>
        
        {/* Tooltip Overlay */}
        {hoveredData && (
          <div style={{
            position: 'absolute',
            left: `${hoveredData.x}px`,
            top: `${hoveredData.y - 75}px`,
            transform: 'translateX(-50%)',
            backgroundColor: 'rgba(10, 16, 35, 0.95)',
            border: '1px solid #a78bfa',
            padding: '8px 12px',
            borderRadius: '6px',
            pointerEvents: 'none',
            zIndex: 100,
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            fontFamily: 'monospace',
            fontSize: '11px',
            lineHeight: 1.4
          }}>
            <div style={{ fontWeight: 'bold', color: '#fff', marginBottom: '4px' }}>{hoveredData.label}</div>
            <div style={{ color: hoveredData.value1Color || '#00e676' }}>{hoveredData.value1}</div>
            {hoveredData.value2 && <div style={{ color: '#fbbf24' }}>{hoveredData.value2}</div>}
            {hoveredData.extraLines && hoveredData.extraLines.map((line, i) => (
              <div key={i} style={{ color: 'rgba(255,255,255,0.6)' }}>{line}</div>
            ))}
          </div>
        )}

        {/* Gamma Stability info popover */}
        {showStabilityInfo && (
          <>
            <div 
              onClick={() => setShowStabilityInfo(false)} 
              style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 199 }} 
            />
            <div
              style={{
                position: 'absolute',
                left: '9%',
                top: `${svgHeight - paddingBottom - stabilityHeight + 18}px`,
                width: '320px',
                maxWidth: '80%',
                backgroundColor: 'rgba(10, 16, 35, 0.97)',
                border: '1px solid #a78bfa',
                borderRadius: '8px',
                padding: '12px 14px',
                zIndex: 200,
                boxShadow: '0 6px 18px rgba(0,0,0,0.6)',
                fontSize: '11px',
                lineHeight: 1.5,
                color: '#e2e8f0',
                whiteSpace: 'pre-line'
              }}
            >
              <div style={{ marginBottom: '6px' }}>
                <span style={{ fontWeight: 'bold', color: '#a78bfa' }}>Gamma Stability</span>
              </div>
              {`Gamma Stability mide qué % de los últimos 20 días de trading el activo se mantuvo en el mismo régimen (long o short gamma) que tiene hoy.

stabilityScore = (sesiones en el régimen actual) / 20

100% (o cerca) → el régimen actual lleva ya varias semanas sin cambiar. El mercado está "asentado" en ese comportamiento (si es long gamma: dealers comprando dips/vendiendo rallies, movimientos amortiguados; si es short gamma: dealers amplificando el movimiento, más volátil).

0-20% ("Muy inestable") → el régimen viene cambiando de signo muy seguido dentro de esos 20 días — el mercado está indeciso, difícil de leer, y cualquier señal de régimen actual es poco confiable porque puede voltear de nuevo pronto.`}
          </div>
          </>
        )}
      </div>
      
      {/* Legend */}
      <div style={legendStyle}>
        <div style={legendItemStyle}>
          <div style={{ ...legendColorBoxStyle, backgroundColor: '#00e676' }} />
          <span>Long Gamma (Net GEX +)</span>
        </div>
        <div style={legendItemStyle}>
          <div style={{ ...legendColorBoxStyle, backgroundColor: '#ff2a6d' }} />
          <span>Short Gamma (Net GEX -)</span>
        </div>
        <div style={legendItemStyle}>
          <div style={{ ...legendColorBoxStyle, background: 'repeating-linear-gradient(45deg, #00e676, #00e676 2px, transparent 2px, transparent 4px)', border: '1px solid #00e676' }} />
          <span>Forward Positivo</span>
        </div>
        <div style={legendItemStyle}>
          <div style={{ ...legendColorBoxStyle, background: 'repeating-linear-gradient(45deg, #ff2a6d, #ff2a6d 2px, transparent 2px, transparent 4px)', border: '1px solid #ff2a6d' }} />
          <span>Forward Negativo</span>
        </div>
        <div style={legendItemStyle}>
          <div style={{ ...legendColorBoxStyle, backgroundColor: '#fbbf24', height: '2px' }} />
          <span>Spot Price</span>
        </div>
        <div style={legendItemStyle}>
          <div style={{ ...legendColorBoxStyle, backgroundColor: '#ffffff', height: '2px', borderStyle: 'dashed' }} />
          <span>EMA3 GEX</span>
        </div>
        <div style={legendItemStyle}>
          <div style={{ ...legendColorBoxStyle, backgroundColor: '#a78bfa', height: '2px' }} />
          <span>Gamma Stability</span>
        </div>
      </div>
    </div>
  );
}

// Styles
const containerStyle: React.CSSProperties = {
  backgroundColor: 'rgba(10, 16, 35, 0.6)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  borderRadius: '12px',
  padding: '20px',
  display: 'flex',
  flexDirection: 'column',
  gap: '15px',
  backdropFilter: 'blur(16px)',
  color: '#fff',
  height: '100%',
  marginTop: '0px',
  position: 'relative',
  zIndex: 10
};

const titleStyle: React.CSSProperties = {
  fontSize: '0.9rem',
  fontWeight: 800,
  letterSpacing: '0.05em',
  color: '#a78bfa',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
  paddingBottom: '10px'
};

const svgStyle: React.CSSProperties = {
  display: 'block',
  overflow: 'visible'
};

const noDataStyle: React.CSSProperties = {
  padding: '40px',
  textAlign: 'center',
  color: 'rgba(255,255,255,0.4)',
  fontStyle: 'italic',
  fontSize: '0.85rem'
};

const legendStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '16px',
  justifyContent: 'center',
  paddingTop: '10px',
  borderTop: '1px solid rgba(255,255,255,0.06)',
  fontSize: '0.75rem',
  color: 'rgba(255,255,255,0.6)'
};

const legendItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px'
};

const legendColorBoxStyle: React.CSSProperties = {
  width: '12px',
  height: '8px',
  borderRadius: '2px'
};
