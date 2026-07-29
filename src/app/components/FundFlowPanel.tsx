import React, { useState } from 'react';
import { Activity, AlertCircle } from 'lucide-react';

export interface SectorFlowEntry {
  date: string;
  last?: number;
  prev_close?: number;
  call_premium?: number;
  put_premium?: number;
  bullish_premium?: number;
  bearish_premium?: number;
  call_volume?: number;
  put_volume?: number;
  volume?: number;
  net_flow?: number | null;
  net_flow_date?: string | null;
}

export interface SectorFlowSeries {
  ticker: string;
  history: SectorFlowEntry[];
}

export interface MarketTideEntry {
  date: string;
  net_call_premium: number;
  net_put_premium: number;
  minutes_captured: number;
}

export interface CotEntry {
  date: string;
  instrument: 'ES' | 'NQ' | 'VX';
  open_interest: number;
  asset_mgr_net: number;
  asset_mgr_net_change: number;
  lev_money_net: number;
  lev_money_net_change: number;
}

export interface FundFlowAlert {
  id: string;
  ticker: string;
  type: 'QUIET_DISTRIBUTION' | 'QUIET_ACCUMULATION';
  streak_days: number;
  net_flow_dates: string[];
  net_flow_total: number;
  price_change_pct: number;
  date: string;
  detected_at: string;
}

interface FundFlowPanelProps {
  sectorFlow: SectorFlowSeries[];
  marketTide: MarketTideEntry | null;
  cotPositioning: CotEntry[];
  fundFlowAlerts: FundFlowAlert[];
  loading: boolean;
}

const MAX_BAR_DAYS = 30;
const BAR_WIDTH = 2;
const BAR_GAP = 1;
const MONTH_GAP = 4;
const CHART_HEIGHT = 24;

// Same dedupe-by-net_flow_date idea as scripts/check-fund-flow-shifts.js:
// a date can appear more than once in the raw history (its own backfilled
// row + mirrored onto "today"'s row), so this collapses to one point per
// real trading day before charting it.
function dedupedFlowSeries(history: SectorFlowEntry[]): { date: string; net_flow: number }[] {
  const byDate = new Map<string, number>();
  for (const h of history) {
    if (h.net_flow == null || !h.net_flow_date) continue;
    byDate.set(h.net_flow_date, h.net_flow);
  }
  return Array.from(byDate, ([date, net_flow]) => ({ date, net_flow })).sort((a, b) => a.date.localeCompare(b.date));
}

type BarPoint = { date: string; value: number };

type MetricBarsProps = {
  series: BarPoint[];
  formatValue: (v: number) => string;
  height?: number;
  barWidth?: number;
  barGap?: number;
  monthGap?: number;
  // Stretches the chart to fill a percentage of its container's width
  // (viewBox + width:<widthPercent>%) instead of rendering at a fixed pixel
  // width - used for the COT bars so 52 weekly bars are actually readable
  // within the panel's column, instead of the ETF sparklines' fixed narrow width.
  responsive?: boolean;
  widthPercent?: number;
};

// Generic inline sparkline: green bar = positive, red = negative, with a
// dashed divider whenever the month changes between two consecutive bars
// (e.g. the last day of July next to the first day of August). Used for
// both the ETF net_flow history and the COT weekly net-change history -
// only the input series, sizing, and the tooltip value formatter differ.
function MetricBars({
  series,
  formatValue,
  height = CHART_HEIGHT,
  barWidth = BAR_WIDTH,
  barGap = BAR_GAP,
  monthGap = MONTH_GAP,
  responsive = false,
  widthPercent = 100
}: MetricBarsProps) {
  // Native SVG <title> tooltips are just as unreliable as the HTML `title`
  // attribute (slow/inconsistent trigger) - same lesson as the sector value
  // tooltip earlier. Use the same hover-state + foreignObject pattern
  // GammaRegimeChart.tsx already relies on instead.
  const [hovered, setHovered] = useState<{ x: number; date: string; value: number } | null>(null);

  if (series.length === 0) {
    return <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)' }}>Sin historial</span>;
  }

  const maxAbs = Math.max(...series.map(d => Math.abs(d.value)), 1);
  let cursor = 0;
  const bars = series.map((d, i) => {
    const prevMonth = i > 0 ? series[i - 1].date.slice(0, 7) : null;
    const thisMonth = d.date.slice(0, 7);
    const isMonthStart = prevMonth !== null && prevMonth !== thisMonth;
    if (isMonthStart) cursor += monthGap;
    const x = cursor;
    cursor += barWidth + barGap;
    const barHeight = Math.max(1, (Math.abs(d.value) / maxAbs) * (height / 2));
    const y = d.value >= 0 ? height / 2 - barHeight : height / 2;
    return { ...d, x, isMonthStart, barHeight, y };
  });
  const width = cursor;

  return (
    <svg
      width={responsive ? `${widthPercent}%` : width}
      height={height}
      viewBox={responsive ? `0 0 ${width} ${height}` : undefined}
      preserveAspectRatio={responsive ? 'none' : undefined}
      style={{ display: 'block', flexShrink: 0, overflow: 'visible' }}
    >
      <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
      {bars.map(b => (
        <React.Fragment key={b.date}>
          {b.isMonthStart && (
            <line
              x1={b.x - monthGap / 2}
              x2={b.x - monthGap / 2}
              y1={0}
              y2={height}
              stroke="rgba(255,255,255,0.3)"
              strokeDasharray="2,2"
            />
          )}
          <rect
            x={b.x - 1}
            y={0}
            width={barWidth + 2}
            height={height}
            fill="transparent"
            onMouseEnter={() => setHovered({ x: b.x + barWidth / 2, date: b.date, value: b.value })}
            onMouseLeave={() => setHovered(null)}
            style={{ cursor: 'pointer' }}
          />
          <rect x={b.x} y={b.y} width={barWidth} height={b.barHeight} fill={b.value >= 0 ? '#00e676' : '#ff2a6d'} style={{ pointerEvents: 'none' }} />
        </React.Fragment>
      ))}

      {hovered && (
        <foreignObject x={hovered.x - 60} y={-54} width={120} height={50} style={{ pointerEvents: 'none', overflow: 'visible' }}>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{
              backgroundColor: 'rgba(10, 16, 35, 0.95)',
              border: '1px solid #a78bfa',
              borderRadius: '6px',
              padding: '4px 8px',
              fontFamily: 'monospace',
              fontSize: '10px',
              lineHeight: 1.4,
              width: 'max-content',
              boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
            }}>
              <div style={{ color: 'rgba(255,255,255,0.6)' }}>{hovered.date}</div>
              <div style={{ color: hovered.value >= 0 ? '#00e676' : '#ff2a6d', fontWeight: 700 }}>
                {formatValue(hovered.value)}
              </div>
            </div>
          </div>
        </foreignObject>
      )}
    </svg>
  );
}

function SectorFlowBars({ history }: { history: SectorFlowEntry[] }) {
  const series: BarPoint[] = dedupedFlowSeries(history)
    .slice(-MAX_BAR_DAYS)
    .map(d => ({ date: d.date, value: d.net_flow }));
  return <MetricBars series={series} formatValue={formatMoney} />;
}

const COT_CHART_HEIGHT = 56;
const COT_BAR_WIDTH = 4;
const COT_BAR_GAP = 2;

// COT reports are weekly (one point/week), so the equivalent of the ETF
// bars' "last 30 trading days" is the last 52 report weeks - a full
// calendar year - rather than a calendar-day cutoff.
const COT_BAR_WEEKS = 52;

function cotChangeSeries(entries: CotEntry[], field: 'asset_mgr_net_change' | 'lev_money_net_change'): BarPoint[] {
  return entries
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-COT_BAR_WEEKS)
    .map(e => ({ date: e.date, value: e[field] }));
}

function formatContracts(val: number | null | undefined): string {
  if (val === null || val === undefined || Number.isNaN(val)) return 'N/D';
  return `${val >= 0 ? '+' : ''}${val.toLocaleString()}`;
}

// SPDR sector ETFs are fixed, well-known tickers - a small hardcoded label map
// is simpler and more reliable here than round-tripping UW's full_name field
// through the daily cache just for display text.
const SECTOR_LABELS: Record<string, string> = {
  SPY: 'S&P 500',
  XLK: 'Technology',
  XLF: 'Financials',
  XLE: 'Energy',
  XLV: 'Health Care',
  XLY: 'Consumer Discretionary',
  XLP: 'Consumer Staples',
  XLI: 'Industrials',
  XLB: 'Materials',
  XLU: 'Utilities',
  XLRE: 'Real Estate',
  XLC: 'Communication Services'
};

function formatMoney(val: number | null | undefined): string {
  if (val === null || val === undefined || Number.isNaN(val)) return 'N/D';
  const absVal = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (absVal >= 1.0e9) return `${sign}$${(absVal / 1.0e9).toFixed(2)}B`;
  if (absVal >= 1.0e6) return `${sign}$${(absVal / 1.0e6).toFixed(2)}M`;
  if (absVal >= 1.0e3) return `${sign}$${(absVal / 1.0e3).toFixed(1)}K`;
  return `${sign}$${absVal.toFixed(0)}`;
}

export default function FundFlowPanel({ sectorFlow, marketTide, cotPositioning, fundFlowAlerts, loading }: FundFlowPanelProps) {
  if (loading) {
    return (
      <div style={panelContainerStyle}>
        <div style={headerStyle}>
          <Activity size={18} style={{ color: '#a78bfa' }} />
          <h3 style={titleStyle}>FUND FLOW & POSICIONAMIENTO</h3>
        </div>
        <div style={loadingContainerStyle}>
          <div className="animate-pulse" style={loadingTextStyle}>
            Cargando flujo de fondos y posicionamiento COT...
          </div>
        </div>
      </div>
    );
  }

  if (sectorFlow.length === 0 && !marketTide) {
    return (
      <div style={panelContainerStyle}>
        <div style={headerStyle}>
          <Activity size={18} style={{ color: '#a78bfa' }} />
          <h3 style={titleStyle}>FUND FLOW & POSICIONAMIENTO</h3>
        </div>
        <div style={errorContainerStyle}>
          <AlertCircle size={24} style={{ color: 'rgba(255,255,255,0.2)' }} />
          <div style={errorTitleStyle}>Sin datos todavía</div>
          <div style={errorDescStyle}>
            Este panel se completa con la primera corrida de <code>fund-flow-daily.yml</code> (post-cierre de mercado).
          </div>
        </div>
      </div>
    );
  }

  const sectorsWithLatest = sectorFlow.map(s => ({
    ...s,
    latest: s.history[s.history.length - 1] as SectorFlowEntry | undefined
  }));
  const sortedSectors = [...sectorsWithLatest].sort(
    (a, b) => (b.latest?.net_flow ?? -Infinity) - (a.latest?.net_flow ?? -Infinity)
  );
  const netTide = marketTide ? marketTide.net_call_premium + marketTide.net_put_premium : null;

  const COT_INSTRUMENT_ORDER: CotEntry['instrument'][] = ['ES', 'NQ', 'VX'];
  const cotByInstrument = new Map<string, CotEntry[]>();
  for (const entry of cotPositioning) {
    const arr = cotByInstrument.get(entry.instrument) ?? [];
    arr.push(entry);
    cotByInstrument.set(entry.instrument, arr);
  }
  const cotInstruments = COT_INSTRUMENT_ORDER.filter(i => cotByInstrument.has(i)).map(instrument => {
    const entries = [...cotByInstrument.get(instrument)!].sort((a, b) => a.date.localeCompare(b.date));
    return {
      instrument,
      latest: entries[entries.length - 1],
      assetMgrSeries: cotChangeSeries(entries, 'asset_mgr_net_change'),
      levMoneySeries: cotChangeSeries(entries, 'lev_money_net_change')
    };
  });

  return (
    <div style={panelContainerStyle}>
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Activity size={18} style={{ color: '#a78bfa' }} />
          <h3 style={titleStyle}>FUND FLOW & POSICIONAMIENTO</h3>
        </div>
        {marketTide && (
          <div style={{ display: 'flex', gap: '16px', fontSize: '0.75rem' }}>
            <span style={{ color: 'rgba(255,255,255,0.5)' }}>
              Market Tide ({marketTide.date}):
            </span>
            <span style={{ color: netTide !== null && netTide >= 0 ? '#00e676' : '#ff2a6d', fontWeight: 700, fontFamily: 'monospace' }}>
              {formatMoney(netTide)}
            </span>
          </div>
        )}
      </div>

      <div style={gridStyle}>
        {/* Sector Flow */}
        <div style={{ ...colStyle, minWidth: '320px' }}>
          <h4 style={colHeaderStyle}>FLUJO NETO POR SECTOR (ETF, IN/OUT FLOW, 30D)</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {sortedSectors.map(s => (
              <div key={s.ticker} style={sectorRowStyle}>
                <span style={{ ...sectorTickerStyle, flex: '0 0 88px' }}>
                  {s.ticker}
                  <span style={sectorLabelStyle}>{SECTOR_LABELS[s.ticker] ?? ''}</span>
                </span>
                <SectorFlowBars history={s.history} />
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flex: '0 0 auto', marginLeft: 'auto' }}>
                  <span
                    style={{
                      fontFamily: 'monospace',
                      fontWeight: 700,
                      fontSize: '0.75rem',
                      color: s.latest?.net_flow == null ? 'rgba(255,255,255,0.3)' : s.latest.net_flow >= 0 ? '#00e676' : '#ff2a6d'
                    }}
                  >
                    {s.latest?.net_flow == null ? 'N/D' : formatMoney(s.latest.net_flow)}
                  </span>
                  {s.latest?.net_flow_date && (
                    <span style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.35)' }}>al {s.latest.net_flow_date}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* COT Positioning */}
        <div style={{ ...colStyle, borderRight: 'none' }}>
          <h4 style={colHeaderStyle}>COT (CFTC, SEMANAL, 52W)</h4>
          {cotInstruments.length === 0 ? (
            <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)' }}>Sin reporte todavía.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {cotInstruments.map(({ instrument, latest: c, assetMgrSeries, levMoneySeries }) => (
                <div key={instrument} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                    <span style={{ fontWeight: 700 }}>{instrument}</span>
                    <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.7rem' }}>{c.date}</span>
                  </div>
                  <div style={cotMetricBlockStyle}>
                    <div style={cotMetricHeaderStyle}>
                      <span style={labelStyle}>Asset Mgr</span>
                      <span style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
                        <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.8rem', color: c.asset_mgr_net >= 0 ? '#00e676' : '#ff2a6d' }}>
                          {c.asset_mgr_net.toLocaleString()}
                        </span>
                        <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.4)' }}>
                          ({formatContracts(c.asset_mgr_net_change)})
                        </span>
                      </span>
                    </div>
                    <MetricBars
                      series={assetMgrSeries}
                      formatValue={formatContracts}
                      responsive
                      widthPercent={75}
                      height={COT_CHART_HEIGHT}
                      barWidth={COT_BAR_WIDTH}
                      barGap={COT_BAR_GAP}
                    />
                  </div>
                  <div style={cotMetricBlockStyle}>
                    <div style={cotMetricHeaderStyle}>
                      <span style={labelStyle}>Leveraged Funds</span>
                      <span style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
                        <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.8rem', color: c.lev_money_net >= 0 ? '#00e676' : '#ff2a6d' }}>
                          {c.lev_money_net.toLocaleString()}
                        </span>
                        <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.4)' }}>
                          ({formatContracts(c.lev_money_net_change)})
                        </span>
                      </span>
                    </div>
                    <MetricBars
                      series={levMoneySeries}
                      formatValue={formatContracts}
                      responsive
                      widthPercent={75}
                      height={COT_CHART_HEIGHT}
                      barWidth={COT_BAR_WIDTH}
                      barGap={COT_BAR_GAP}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {fundFlowAlerts.length > 0 && (
        <div style={alertsContainerStyle}>
          <h4 style={colHeaderStyle}>SEÑALES (DIVERGENCIA PRECIO / FLUJO)</h4>
          {fundFlowAlerts.map(a => {
            const isDistribution = a.type === 'QUIET_DISTRIBUTION';
            const color = isDistribution ? '#ff2a6d' : '#00e676';
            const bg = isDistribution ? 'rgba(255,42,109,0.06)' : 'rgba(0,230,118,0.06)';
            const border = isDistribution ? 'rgba(255,42,109,0.25)' : 'rgba(0,230,118,0.25)';
            return (
              <div key={a.id} style={{ ...alertCardStyle, backgroundColor: bg, borderColor: border }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 800, fontSize: '0.8rem', color }}>
                    {a.ticker} — {isDistribution ? 'Distribución silenciosa' : 'Acumulación silenciosa'}
                  </span>
                  <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)' }}>{a.date}</span>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.7)', marginTop: '4px' }}>
                  {a.streak_days} sesiones de {isDistribution ? 'salida' : 'entrada'} neta ({formatMoney(a.net_flow_total)} acumulado)
                  {' '}mientras el precio {isDistribution ? 'se sostuvo' : 'no acompañó'} ({a.price_change_pct >= 0 ? '+' : ''}{a.price_change_pct.toFixed(2)}%).
                </div>
              </div>
            );
          })}
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

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: '24px'
};

const colStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  borderRight: '1px solid rgba(255, 255, 255, 0.06)',
  paddingRight: '16px'
};

const colHeaderStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.75rem',
  fontWeight: 800,
  color: 'rgba(255,255,255,0.4)',
  letterSpacing: '0.08em'
};

const sectorRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  fontSize: '0.8rem'
};

const cotMetricBlockStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px'
};

const cotMetricHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  fontSize: '0.75rem'
};

const sectorTickerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '6px',
  fontWeight: 700
};

const sectorLabelStyle: React.CSSProperties = {
  fontWeight: 400,
  fontSize: '0.7rem',
  color: 'rgba(255,255,255,0.4)'
};


const labelStyle: React.CSSProperties = {
  color: 'rgba(255,255,255,0.6)'
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

const alertsContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  borderTop: '1px solid rgba(255,255,255,0.06)',
  paddingTop: '16px'
};

const alertCardStyle: React.CSSProperties = {
  padding: '12px 16px',
  borderRadius: '10px',
  borderWidth: '1px',
  borderStyle: 'solid'
};
