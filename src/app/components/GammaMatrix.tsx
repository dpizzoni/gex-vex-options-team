import React, { useMemo, useState } from "react";
import styles from "./GammaMatrix.module.css";
import { Download, X } from "lucide-react";
import { calcT, calcVanna, sanitizeIV } from "@/lib/gex-engine";

export interface MatrixRawData {
  expiration: string;
  calls: any[];
  puts: any[];
}

interface GammaMatrixProps {
  rawData: MatrixRawData[];
  exposureType: "GEX" | "VEX";
  aggregation: "RAW" | "DEALER";
  spot: number;
  symbol?: string;
  relevantOnly?: boolean;
  colorTheme?: "GEX" | "VEX";
  alignColorScaleWithMax?: number;
  hoveredStrike?: number | null;
  onHoverStrike?: (strike: number | null) => void;
  selectedNode?: { strike: number, expiry: string } | null;
  onSelectNode?: (node: { strike: number, expiry: string } | null) => void;
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  onScroll?: (e: React.UIEvent<HTMLDivElement>) => void;
  onStatsUpdate?: (stats: any) => void;
  dealerCache?: Record<string, any> | null;
}

export default function GammaMatrix({ 
  rawData, exposureType, aggregation, spot, symbol = "SPY", relevantOnly = true, colorTheme = "GEX", alignColorScaleWithMax, 
  hoveredStrike, onHoverStrike, selectedNode, onSelectNode, scrollRef, onScroll, onStatsUpdate, dealerCache 
}: GammaMatrixProps) {

  // Ref to the spot-closest row for auto-centering
  const spotRowRef = React.useRef<HTMLTableRowElement | null>(null);

  const {
    matrixData,
    maxAbsExposure,
    strikes,
    expirations,
    kingNode,
    maxPositives,
    maxNegatives,
    totalGex,
    totalVex,
    threshold,
    visibleNodes,
    hiddenNodes
  } = useMemo(() => {
    if (!rawData || rawData.length === 0) {
      return {
        matrixData: new Map(), maxAbsExposure: 0, strikes: [], expirations: [],
        kingNode: null, maxPositives: {} as Record<string, {strike: number, val: number}>, maxNegatives: {} as Record<string, {strike: number, val: number}>, totalGex: 0, totalVex: 0,
        threshold: 0, visibleNodes: 0, hiddenNodes: 0
      };
    }

    // Process all data into a flat array of options with computed VEX
    const allOptions: any[] = [];

    rawData.forEach(chain => {
      const expDateStr = chain.expiration;
      const T = calcT(expDateStr);

      const processChain = (opts: any[], type: "CALL" | "PUT") => {
        opts.forEach(opt => {
          let vex = 0;
          const sigma = sanitizeIV(opt.impliedVolatility); // R5: use engine's sanitizeIV [0.03, 4.0]

          if (sigma > 0 && spot > 0) {
            const vanna = calcVanna(spot, opt.strike, T, sigma);
            vex = vanna * opt.openInterest * spot; // raw unsigned vex — sign applied in getVexValue
          }
          
          allOptions.push({
            ...opt,
            type,
            expiration: expDateStr,
            vex
          });
        });
      };
      
      processChain(chain.calls || [], "CALL");
      processChain(chain.puts || [], "PUT");
    });

    // Group by Strike -> Expiry -> { netGex, netVex, ... }
    const matrixMap = new Map<number, Map<string, any>>();
    const expsSet = new Set<string>();
    
    let totalGexCalc = 0;
    let totalVexCalc = 0;

    const getExposureValue = (mode: "RAW" | "DEALER", contract: any, baseValue: number) => {
      if (mode === "RAW") return baseValue;
      if (mode === "DEALER") {
        // AUDIT C2+C3 FIX: dealer = OPUESTO al cliente → multiplicar por -clientBias
        // Default SqueezeMetrics: cliente largo puts (+1), corto calls (-1)
        let clientBias = contract.type === "CALL" ? -1 : 1;
        const occId = (() => {
          const dateStr = contract.expiration.replace(/-/g, "").slice(2);
          const typeStr = contract.type === "CALL" ? "C" : "P";
          const strikeStr = Math.round(contract.strike * 1000).toString().padStart(8, "0");
          return `${symbol}${dateStr}${typeStr}${strikeStr}`;
        })();

        if (dealerCache && dealerCache[occId]) {
          clientBias = dealerCache[occId].bias; // bias = posicionamiento del CLIENTE
        }
        // dealer = -clientBias → signo correcto para calls Y puts
        return -clientBias * Math.abs(baseValue);
      }
      return baseValue;
    };

    // R2+R3: separate VEX transformer — RAW applies type sign, DEALER skips abs (vanna has intrinsic sign)
    const getVexValue = (mode: "RAW" | "DEALER", contract: any, rawVex: number, type: "CALL" | "PUT") => {
      if (mode === "RAW") return (type === "CALL" ? 1 : -1) * rawVex;
      if (mode === "DEALER") {
        let clientBias = type === "CALL" ? -1 : 1;
        const occId = (() => {
          const dateStr = contract.expiration.replace(/-/g, "").slice(2);
          const typeStr = type === "CALL" ? "C" : "P";
          const strikeStr = Math.round(contract.strike * 1000).toString().padStart(8, "0");
          return `${symbol}${dateStr}${typeStr}${strikeStr}`;
        })();
        if (dealerCache && dealerCache[occId]) clientBias = dealerCache[occId].bias;
        return -clientBias * rawVex; // no abs: vanna sign is intrinsic (from d2), abs would corrupt ITM
      }
      return rawVex;
    };

    allOptions.forEach(opt => {
      expsSet.add(opt.expiration);
      if (!matrixMap.has(opt.strike)) {
        matrixMap.set(opt.strike, new Map());
      }
      const strikeMap = matrixMap.get(opt.strike)!;
      if (!strikeMap.has(opt.expiration)) {
        strikeMap.set(opt.expiration, {
          strike: opt.strike,
          expiration: opt.expiration,
          netGex: 0,
          netVex: 0,
          callGex: 0,
          putGex: 0,
          callVex: 0,
          putVex: 0,
          callCount: 0,
          putCount: 0,
          totalOi: 0,
          totalVol: 0
        });
      }
      
      const cell = strikeMap.get(opt.expiration)!;
      cell.totalOi += opt.openInterest || 0;
      cell.totalVol += opt.volume || 0;

      const valGex = getExposureValue(aggregation, opt, opt.gex || 0);
      const valVex = getVexValue(aggregation, opt, opt.vex || 0, opt.type);

      if (opt.type === "CALL") {
        cell.callGex += valGex;
        cell.callVex += valVex;
        cell.callCount += opt.openInterest;
      } else {
        cell.putGex += valGex;
        cell.putVex += valVex;
        cell.putCount += opt.openInterest;
      }
    });

    const expArray = Array.from(expsSet).sort();
    const strikeArray = Array.from(matrixMap.keys()).sort((a, b) => b - a);

    let localMaxAbs = 0;
    let localKing = { strike: 0, expiry: "", val: 0 };
    const mPos: Record<string, { strike: number, val: number }> = {};
    const mNeg: Record<string, { strike: number, val: number }> = {};

    expArray.forEach(exp => {
      mPos[exp] = { strike: 0, val: -Infinity };
      mNeg[exp] = { strike: 0, val: Infinity };
    });

    strikeArray.forEach(st => {
      const row = matrixMap.get(st)!;
      expArray.forEach(exp => {
        if (row.has(exp)) {
          const cell = row.get(exp)!;
          
          let valGex = 0;
          let valVex = 0;
          
          if (aggregation === "RAW" || aggregation === "DEALER") {
            valGex = cell.callGex + cell.putGex;
            valVex = cell.callVex + cell.putVex;
          }
          
          cell.netGex = valGex;
          cell.netVex = valVex;

          const val = exposureType === "GEX" ? valGex : valVex;
          
          const absVal = Math.abs(val);
          if (absVal > localMaxAbs) localMaxAbs = absVal;
          if (absVal > Math.abs(localKing.val)) {
            localKing = { strike: st, expiry: exp, val: val };
          }
          
          if (val > mPos[exp].val) mPos[exp] = { strike: st, val: val };
          if (val < mNeg[exp].val) mNeg[exp] = { strike: st, val: val };
        }
      });
    });

    const threshold = localMaxAbs * 0.10;
    let visibleNodes = 0;
    let hiddenNodes = 0;

    strikeArray.forEach(st => {
      const row = matrixMap.get(st)!;
      expArray.forEach(exp => {
        if (row.has(exp)) {
          const cell = row.get(exp)!;
          const val = exposureType === "GEX" ? cell.netGex : cell.netVex;
          
          const isKing = localKing?.strike === st && localKing?.expiry === exp;
          const isMaxPos = mPos[exp]?.strike === st && mPos[exp]?.val > 0;
          const isMaxNeg = mNeg[exp]?.strike === st && mNeg[exp]?.val < 0;
          const isNearSpot = Math.abs(st - spot) <= 5; // Spot ± 5 strikes distance roughly. Wait, diff 5 points.
          
          // Determine if hidden
          let hidden = false;
          if (relevantOnly) {
            if (Math.abs(val) < threshold) {
              hidden = true;
            }
            if (isKing || isMaxPos || isMaxNeg || isNearSpot) {
              hidden = false;
            }
          }
          
          cell._hidden = hidden;
          if (hidden) hiddenNodes++;
          else visibleNodes++;
        }
      });
    });

    return {
      matrixData: matrixMap,
      maxAbsExposure: localMaxAbs,
      strikes: strikeArray,
      expirations: expArray,
      kingNode: localKing,
      maxPositives: mPos,
      maxNegatives: mNeg,
      totalGex: totalGexCalc,
      totalVex: totalVexCalc,
      threshold,
      visibleNodes,
      hiddenNodes
    };
  }, [rawData, exposureType, aggregation, spot, symbol, relevantOnly, dealerCache]);

  const onStatsUpdateRef = React.useRef(onStatsUpdate);
  React.useEffect(() => {
    onStatsUpdateRef.current = onStatsUpdate;
  }, [onStatsUpdate]);

  React.useEffect(() => {
    if (onStatsUpdateRef.current) {
      onStatsUpdateRef.current({
        threshold,
        visibleNodes,
        hiddenNodes,
        kingNode: kingNode,
        totalExposure: exposureType === "GEX" ? totalGex : totalVex,
        matrixData
      });
    }
  }, [threshold, visibleNodes, hiddenNodes, kingNode, totalGex, totalVex, exposureType, matrixData]);

  // Auto-scroll: center the SPOT row when data changes
  const closestStrike = React.useMemo(() => {
    if (!strikes.length || !spot) return null;
    return strikes.reduce((prev, curr) =>
      Math.abs(curr - spot) < Math.abs(prev - spot) ? curr : prev
    );
  }, [strikes, spot]);

  React.useEffect(() => {
    if (!closestStrike || !scrollRef?.current) return;
    // Small timeout ensures DOM rows are painted before measuring offsets
    const raf = requestAnimationFrame(() => {
      if (!spotRowRef.current || !scrollRef?.current) return;
      const container = scrollRef.current;
      const row = spotRowRef.current;
      const containerH = container.clientHeight;
      const rowTop = row.offsetTop;
      const rowH = row.clientHeight;
      container.scrollTop = rowTop - containerH / 2 + rowH / 2;
    });
    return () => cancelAnimationFrame(raf);
  }, [closestStrike, strikes.length, scrollRef]);

  const formatCompact = (val: number) => {
    const absVal = Math.abs(val);
    const sign = val < 0 ? "−" : "";
    if (absVal >= 1.0e9) return `${sign}$${(absVal / 1.0e9).toFixed(1)}B`;
    if (absVal >= 1.0e6) return `${sign}$${(absVal / 1.0e6).toFixed(1)}M`;
    if (absVal >= 1.0e3) return `${sign}$${(absVal / 1.0e3).toFixed(0)}K`;
    return `${sign}$${absVal.toFixed(0)}`;
  };

  if (!rawData || rawData.length === 0) {
    return <div className={styles.loading}>Loading Matrix Data...</div>;
  }

  const effectiveMaxAbs = alignColorScaleWithMax && alignColorScaleWithMax > maxAbsExposure 
    ? alignColorScaleWithMax 
    : maxAbsExposure;

  // Colors based on theme
  const posColorRGB = colorTheme === "VEX" ? "6, 182, 212" : "0, 230, 118"; // Cyan vs Green
  const negColorRGB = colorTheme === "VEX" ? "217, 70, 239" : "255, 42, 109"; // Magenta vs Red
  const absColorRGB = colorTheme === "VEX" ? "192, 132, 252" : "251, 191, 36"; // Purple vs Yellow
  const posHex = colorTheme === "VEX" ? "#06b6d4" : "#00e676";
  const negHex = colorTheme === "VEX" ? "#d946ef" : "#ff2a6d";
  const absHex = colorTheme === "VEX" ? "#c084fc" : "#fbbf24";

  return (
    <div className={styles.matrixContainer}>
      <div className={styles.toolbar}>
        <div className={styles.legend}>
          <span className={styles.legendItem}><span className={styles.legendBox} style={{background: `rgba(${posColorRGB}, 0.3)`, border: `1px solid ${posHex}`}}/> Max Positive</span>
          <span className={styles.legendItem}><span className={styles.legendBox} style={{background: `rgba(${negColorRGB}, 0.3)`, border: `1px solid ${negHex}`}}/> Max Negative</span>
          <span className={styles.legendItem}><span className={styles.legendBox} style={{background: 'rgba(255, 255, 255, 0.3)', border: '1px solid #fff'}}/> King Node</span>
          <span className={styles.legendItem}><span className={styles.legendBox} style={{background: 'rgba(255, 255, 255, 0.02)'}}/> Air Pocket ({"<"}5%)</span>
        </div>
      </div>

      <div className={styles.scrollWrapper} ref={scrollRef} onScroll={onScroll}>
        <table className={styles.matrixTable}>
          <thead>
            <tr>
              <th className={styles.stickyStrikeHeader}>Strike</th>
              {expirations.map(exp => (
                <th key={exp}>{exp}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {strikes.map(st => {
              const isHoveredRow = hoveredStrike === st;
              const isNearMoney = Math.abs(st - spot) < 5;
              
              const isSpotRow = st === closestStrike;
              return (
              <tr 
                key={st}
                ref={isSpotRow ? spotRowRef : undefined}
                className={`${isNearMoney ? styles.nearTheMoney : ""} ${isHoveredRow ? styles.hoveredCrosshair : ""}`}
                onMouseEnter={() => onHoverStrike && onHoverStrike(st)}
                onMouseLeave={() => onHoverStrike && onHoverStrike(null)}
              >
                <td className={styles.stickyStrikeCell}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span>{Number.isInteger(st) ? st : Number(st.toFixed(2))}</span>
                    {st === closestStrike && (
                      <span className={styles.spotIndicator}>SPOT</span>
                    )}
                  </div>
                </td>
                {expirations.map(exp => {
                  const cell = matrixData.get(st)?.get(exp);
                  if (!cell) return <td key={exp} className={styles.emptyCell}>-</td>;

                  const val = exposureType === "GEX" ? cell.netGex : cell.netVex;
                  const absVal = Math.abs(val);
                  const isAirPocket = maxAbsExposure > 0 && absVal < (maxAbsExposure * 0.05);
                  
                  const isKing = kingNode?.strike === st && kingNode?.expiry === exp;
                  const isMaxPos = maxPositives[exp]?.strike === st && maxPositives[exp]?.val > 0;
                  const isMaxNeg = maxNegatives[exp]?.strike === st && maxNegatives[exp]?.val < 0;
                  const isSelectedCell = selectedNode?.strike === st && selectedNode?.expiry === exp;

                  if (cell._hidden) {
                    return <td key={exp} className={`${styles.dataCell} ${expirations.length > 6 ? styles.compactCell : ''} ${isSelectedCell ? styles.selectedCell : ''}`} style={{ color: "rgba(255,255,255,0.1)", textAlign: "center" }} onClick={() => onSelectNode && onSelectNode({strike: st, expiry: exp})}>—</td>;
                  }

                  let cellClass = `${styles.dataCell} ${expirations.length > 6 ? styles.compactCell : ''} ${isSelectedCell ? styles.selectedCell : ''}`;
                  let inlineStyle: React.CSSProperties = {};
                  let textColor = "#fff";
                  
                  if (isAirPocket) {
                    inlineStyle.background = "rgba(255, 255, 255, 0.02)";
                    textColor = "rgba(255, 255, 255, 0.2)";
                  } else if (absVal > 0) {
                    const opacity = effectiveMaxAbs > 0 ? Math.max(0.1, absVal / effectiveMaxAbs) : 0.1;
                    const colorBase = val >= 0 ? posColorRGB : negColorRGB;
                    inlineStyle.background = `rgba(${colorBase}, ${opacity * 0.5})`;
                    textColor = "#f8fafc";
                  }

                  if (isKing) {
                    inlineStyle.border = "2px solid #fff";
                    inlineStyle.boxShadow = "0 0 10px rgba(255, 255, 255, 0.5) inset";
                  } else if (isMaxPos) {
                    inlineStyle.border = `1px solid ${posHex}`;
                  } else if (isMaxNeg) {
                    inlineStyle.border = `1px solid ${negHex}`;
                  }

                  return (
                    <td 
                      key={exp} 
                      className={cellClass}
                      style={inlineStyle}
                      title={isAirPocket ? "Low dealer exposure" : ""}
                      onClick={() => onSelectNode && onSelectNode({strike: st, expiry: exp})}
                    >
                      <span style={{ color: textColor, fontWeight: (isKing || isMaxPos || isMaxNeg) ? 700 : 400 }}>
                        {formatCompact(val)}
                      </span>
                      {isKing && <span className={styles.kingBadge}>KING</span>}
                    </td>
                  );
                })}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
