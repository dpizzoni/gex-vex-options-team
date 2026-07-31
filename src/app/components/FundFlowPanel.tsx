import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Activity, AlertCircle, Bell, Info, X } from 'lucide-react';

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

const BAR_WIDTH = 2;
const BAR_GAP = 1;
const MONTH_GAP = 4;
const CHART_HEIGHT = 40;

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
    <div style={{ position: 'relative', width: responsive ? `${widthPercent}%` : `${width}px`, flexShrink: 0 }}>
      <svg
        width="100%"
        height={height}
        viewBox={responsive ? `0 0 ${width} ${height}` : undefined}
        preserveAspectRatio={responsive ? 'none' : undefined}
        style={{ display: 'block', overflow: 'visible' }}
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
      </svg>

      {/* Plain HTML overlay, not an SVG foreignObject - a foreignObject here
          would inherit the svg's preserveAspectRatio="none" stretch (needed
          to make the bars fill widthPercent) and render the tooltip text
          non-uniformly squashed/stretched. Percentage-based CSS positioning
          sidesteps that entirely. */}
      {hovered && (
        <div
          style={{
            position: 'absolute',
            left: `${(hovered.x / width) * 100}%`,
            top: 0,
            transform: 'translate(-50%, calc(-100% - 8px))',
            pointerEvents: 'none',
            zIndex: 10
          }}
        >
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
      )}
    </div>
  );
}

const SECTOR_WEEKS_WINDOW = 12;
const WEEKLY_BAR_WIDTH = 6;
const WEEKLY_BAR_GAP = 3;

type DayPoint = { date: string; value: number };
type WeekGroup = { weekStart: string; total: number; days: DayPoint[] };

// Monday of the ISO week containing `dateStr` (UTC, so date-only strings
// don't drift across a local timezone's midnight).
function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diffToMonday);
  return d.toISOString().slice(0, 10);
}

function groupByWeek(series: DayPoint[]): WeekGroup[] {
  const byWeek = new Map<string, WeekGroup>();
  for (const d of series) {
    const key = mondayOf(d.date);
    let group = byWeek.get(key);
    if (!group) {
      group = { weekStart: key, total: 0, days: [] };
      byWeek.set(key, group);
    }
    group.total += d.value;
    group.days.push(d);
  }
  return Array.from(byWeek.values())
    .map(g => ({ ...g, days: [...g.days].sort((a, b) => a.date.localeCompare(b.date)) }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

type HoverInfo = { x: number; title: string; lines: { label: string; value: number }[] };

// Shared calendar-week axis across every sector column: the union of ISO
// weeks (Monday keys) seen in ANY sector's history, capped to the last
// SECTOR_WEEKS_WINDOW. Without this, each sector's bars were positioned by
// their own local index (`groupByWeek(...).slice(-N)`), so a sector missing
// a single week (gap in capture, later listing, etc.) shifted every bar
// after it out of phase with the other columns - making the same calendar
// week land in different x positions per row and defeating the point of
// comparing rotation across sectors visually.
function sharedWeekKeys(allHistories: SectorFlowEntry[][]): string[] {
  const keys = new Set<string>();
  for (const history of allHistories) {
    const daily = dedupedFlowSeries(history).map(d => ({ date: d.date, value: d.net_flow }));
    for (const w of groupByWeek(daily)) keys.add(w.weekStart);
  }
  return Array.from(keys).sort().slice(-SECTOR_WEEKS_WINDOW);
}

// All weeks - including the current, in-progress one - render as the same
// compressed weekly bar. Hovering any bar shows the day-by-day breakdown
// that got collapsed into it, so the detail is still there without making
// the current week look structurally different (which read as confusing to
// anyone unfamiliar with how this chart was built).
function SectorFlowBars({ history, weekKeys }: { history: SectorFlowEntry[]; weekKeys: string[] }) {
  const [hovered, setHovered] = useState<HoverInfo | null>(null);

  const daily: DayPoint[] = dedupedFlowSeries(history).map(d => ({ date: d.date, value: d.net_flow }));
  if (daily.length === 0) {
    return <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)' }}>Sin historial</span>;
  }

  const byWeekStart = new Map(groupByWeek(daily).map(w => [w.weekStart, w]));
  // Every column renders a bar (even a flat zero one) for each shared week
  // key, so week N is always at the same x offset regardless of which weeks
  // this particular sector actually has data for.
  const weeks: WeekGroup[] = weekKeys.map(weekStart => byWeekStart.get(weekStart) ?? { weekStart, total: 0, days: [] });
  const maxAbs = Math.max(...weeks.map(w => Math.abs(w.total)), 1);

  let cursor = 0;
  const weekBars = weeks.map(w => {
    const x = cursor;
    cursor += WEEKLY_BAR_WIDTH + WEEKLY_BAR_GAP;
    const barHeight = Math.max(1, (Math.abs(w.total) / maxAbs) * (CHART_HEIGHT / 2));
    const y = w.total >= 0 ? CHART_HEIGHT / 2 - barHeight : CHART_HEIGHT / 2;
    return { ...w, x, barHeight, y };
  });

  const width = cursor;

  return (
    <svg width={width} height={CHART_HEIGHT} style={{ display: 'block', flexShrink: 0, overflow: 'visible', position: 'relative', zIndex: hovered ? 20 : 'auto' }}>
      <line x1={0} y1={CHART_HEIGHT / 2} x2={width} y2={CHART_HEIGHT / 2} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
      {weekBars.map(w => (
        <React.Fragment key={w.weekStart}>
          <rect
            x={w.x - 1}
            y={0}
            width={WEEKLY_BAR_WIDTH + 2}
            height={CHART_HEIGHT}
            fill="transparent"
            onMouseEnter={() => setHovered({
              x: w.x + WEEKLY_BAR_WIDTH / 2,
              title: `Semana del ${w.weekStart}`,
              lines: [{ label: 'Total', value: w.total }, ...w.days.map(d => ({ label: d.date.slice(5), value: d.value }))]
            })}
            onMouseLeave={() => setHovered(null)}
            style={{ cursor: 'pointer' }}
          />
          <rect x={w.x} y={w.y} width={WEEKLY_BAR_WIDTH} height={w.barHeight} fill={w.total >= 0 ? '#00e676' : '#ff2a6d'} style={{ pointerEvents: 'none' }} />
        </React.Fragment>
      ))}

      {hovered && (() => {
        const maxAbs = Math.max(...hovered.lines.map(l => Math.abs(l.value)), 1);
        const colWidth = 64;
        const barAreaHeight = 100;
        const tooltipWidth = hovered.lines.length * colWidth + 18;
        const tooltipHeight = 18 + 20 + barAreaHeight + 18 + 12;
        return (
          <foreignObject
            x={hovered.x - tooltipWidth / 2}
            y={-(tooltipHeight + 12)}
            width={tooltipWidth}
            height={tooltipHeight}
            style={{ pointerEvents: 'none', overflow: 'visible' }}
          >
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <div style={{
                backgroundColor: 'rgba(10, 16, 35, 0.97)',
                border: '1px solid #a78bfa',
                borderRadius: '8px',
                padding: '10px 12px',
                fontFamily: 'monospace',
                boxShadow: '0 4px 16px rgba(0,0,0,0.5)'
              }}>
                <div style={{ color: 'rgba(255,255,255,0.6)', fontWeight: 700, fontSize: '0.75rem', marginBottom: '8px' }}>{hovered.title}</div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {hovered.lines.map((l, i) => {
                    const color = l.value >= 0 ? '#00e676' : '#ff2a6d';
                    const barH = Math.max(3, (Math.abs(l.value) / maxAbs) * (barAreaHeight / 2));
                    return (
                      <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: `${colWidth}px` }}>
                        <div style={{ color, fontWeight: 700, fontSize: '0.75rem', height: '16px', whiteSpace: 'nowrap' }}>{formatMoney(l.value)}</div>
                        <div style={{ position: 'relative', width: '100%', height: `${barAreaHeight}px` }}>
                          <div style={{ position: 'absolute', left: 0, right: 0, top: barAreaHeight / 2, height: '1px', backgroundColor: 'rgba(255,255,255,0.15)' }} />
                          <div
                            style={{
                              position: 'absolute',
                              left: '50%',
                              transform: 'translateX(-50%)',
                              top: l.value >= 0 ? barAreaHeight / 2 - barH : barAreaHeight / 2,
                              width: '26px',
                              height: `${barH}px`,
                              backgroundColor: color,
                              borderRadius: '3px'
                            }}
                          />
                        </div>
                        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.7rem', fontWeight: 700, height: '16px', marginTop: '4px' }}>{l.label || ' '}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </foreignObject>
        );
      })()}
    </svg>
  );
}

const COT_CHART_HEIGHT = 76;
const COT_BAR_WIDTH = 3;
const COT_BAR_GAP = 3;

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

function CotAlertChip({ alert }: { alert: CotAlert }) {
  const [hovered, setHovered] = useState(false);
  const color = alert.kind === 'divergence' ? '#fbbf24' : '#a78bfa';

  return (
    <div style={{ position: 'relative' }} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div
        style={{
          ...cotAlertChipStyle,
          borderColor: alert.kind === 'divergence' ? 'rgba(251,191,36,0.4)' : 'rgba(167,139,250,0.4)',
          color,
          cursor: 'help'
        }}
      >
        {alert.kind === 'divergence' ? '⚠' : '📊'} {alert.text}
      </div>
      {hovered && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginTop: '6px',
            width: '260px',
            backgroundColor: 'rgba(10, 16, 35, 0.98)',
            border: `1px solid ${color}`,
            borderRadius: '6px',
            padding: '8px 10px',
            fontSize: '0.7rem',
            lineHeight: 1.5,
            color: 'rgba(255,255,255,0.8)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            zIndex: 30,
            pointerEvents: 'none'
          }}
        >
          {alert.description}
        </div>
      )}
    </div>
  );
}

function CotInfoModal({ onClose }: { onClose: () => void }) {
  // Portal to document.body: same backdrop-filter stacking-context issue as
  // the other panels' info modals.
  return createPortal(
    <div style={infoOverlayStyle} onClick={onClose}>
      <div style={infoModalStyle} onClick={e => e.stopPropagation()}>
        <div style={infoModalHeaderStyle}>
          <span style={{ fontWeight: 800, fontSize: '0.95rem', color: '#a78bfa' }}>¿Qué es el reporte COT?</span>
          <button onClick={onClose} style={infoCloseButtonStyle} aria-label="Cerrar"><X size={16} /></button>
        </div>

        <p style={infoTextStyle}>
          El Commitment of Traders (CFTC) publica cada viernes el posicionamiento agregado en futuros de la
          semana que cerró el martes anterior — no es en tiempo real, tiene ~3-4 días de rezago, pero es la única
          fuente pública de "quién tiene qué posición" en el mercado de futuros por tipo de trader.
        </p>

        <div style={infoSectionStyle}>
          <div style={infoTermStyle}>Instrumentos: ES, NQ, VX</div>
          <p style={infoTextStyle}>
            ES = futuros del S&amp;P 500, NQ = futuros del Nasdaq 100, VX = futuros del VIX. Los tres muestran el
            posicionamiento neto (contratos largos menos cortos) de cada categoría de trader.
          </p>
        </div>

        <div style={infoSectionStyle}>
          <div style={infoTermStyle}>Asset Managers ("dinero real")</div>
          <p style={infoTextStyle}>
            Fondos de pensión, aseguradoras, asset managers tradicionales — posiciones más estructurales/de largo
            plazo, menos reactivas a movimientos de corto plazo. Se los toma como proxy de convicción institucional.
          </p>
        </div>

        <div style={infoSectionStyle}>
          <div style={infoTermStyle}>Leveraged Funds ("dinero especulativo")</div>
          <p style={infoTextStyle}>
            Hedge funds y CTAs — posiciones tácticas, apalancadas, que rotan rápido con el momentum del precio.
            Se los toma como proxy de especulación de corto plazo, no de convicción de fondo.
          </p>
        </div>

        <div style={{ ...infoSectionStyle, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '12px' }}>
          <div style={{ ...infoTermStyle, color: '#fbbf24' }}>⚠ Alerta de Divergencia</div>
          <p style={infoTextStyle}>
            Se dispara cuando Asset Managers y Leveraged Funds cambiaron su neto en direcciones opuestas esta
            semana, ambos por más que su movimiento semanal típico (umbral auto-calibrado por instrumento, ya que
            ES/NQ/VX operan en escalas de contratos muy distintas). Señala que un movimiento del mercado lo está
            llevando el dinero táctico y no el institucional — o viceversa —, algo que ni gamma-regime ni fund-flow
            pueden ver porque ninguno de los dos mide posicionamiento en futuros.
          </p>
        </div>

        <div style={infoSectionStyle}>
          <div style={{ ...infoTermStyle, color: '#a78bfa' }}>📊 Alerta de Extremo (52 semanas)</div>
          <p style={infoTextStyle}>
            Se dispara cuando el neto actual de una categoría es el máximo o mínimo de las últimas 52 semanas.
            Es la señal contraria clásica de "posicionamiento demasiado cargado hacia un lado": cuanto más extremo
            y unánime el posicionamiento, menos margen queda para que ese mismo grupo siga empujando en la misma
            dirección, y mayor la probabilidad de que un catalizador menor dispare una reversión o short/long
            squeeze.
          </p>
        </div>

        <div style={{ ...infoSectionStyle, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '12px' }}>
          <div style={{ ...infoTermStyle, color: '#fff' }}>Cómo leerlo en conjunto</div>
          <p style={infoTextStyle}>
            El caso más informativo es cuando ambas alertas coinciden: por ejemplo, Leveraged Funds en máximo
            histórico de 52 semanas MIENTRAS Asset Managers reduce su exposición esa misma semana — eso es
            "dinero apalancado llevando el mercado a un extremo mientras el dinero real se retira", una
            combinación que históricamente precede correcciones más que cualquiera de las dos señales por
            separado. Si solo aparece la de extremo sin divergencia, el posicionamiento está cargado pero
            todavía hay consenso entre ambos grupos — menos urgente.
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
}

type CotAlert = { kind: 'divergence' | 'extreme'; text: string; description: string };

const COT_ALERT_DESCRIPTIONS: Record<CotAlert['kind'], string> = {
  divergence: 'Asset Managers ("dinero real") y Leveraged Funds ("dinero especulativo/apalancado") movieron su posición neta en direcciones opuestas esta semana, cada uno por más que su movimiento semanal típico. Señala que el mercado se está moviendo por convicción táctica de corto plazo, no por convicción institucional de fondo (o viceversa).',
  extreme: 'El posicionamiento neto actual es el máximo o mínimo de las últimas 52 semanas — señal clásica de posicionamiento "cargado" hacia un lado, que históricamente deja poco margen para que ese mismo grupo siga empujando en la misma dirección y aumenta la probabilidad de una reversión.'
};

// Two rules-based signals from the 52-week COT window - complementary to
// gamma-regime (options/dealers) and fund-flow (ETF $/price) alerts because
// COT is the only source here that measures futures positioning by trader
// type, not price or options flow:
//
// 1. Divergence: Asset Managers ("real money") and Leveraged Funds
//    ("speculative/tactical") moved in opposite directions this week, both
//    by more than a "typical" week's move for that instrument (self-scaled
//    via the median absolute weekly change, since ES/NQ/VX have very
//    different contract-count scales). Flags whether a move is being led by
//    real institutional conviction or by tactical leverage.
// 2. Extreme positioning: current net position is the highest or lowest in
//    the trailing 52 weeks - classic "crowded positioning" signal that
//    often precedes a reversal.
function computeCotAlerts(entries: CotEntry[]): CotAlert[] {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 8) return [];
  const latest = sorted[sorted.length - 1];
  const alerts: CotAlert[] = [];

  const median = (nums: number[]) => {
    const s = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
  };

  const amChanges = sorted.map(e => Math.abs(e.asset_mgr_net_change));
  const lmChanges = sorted.map(e => Math.abs(e.lev_money_net_change));
  const amThreshold = median(amChanges);
  const lmThreshold = median(lmChanges);

  const amMoved = Math.abs(latest.asset_mgr_net_change) > amThreshold;
  const lmMoved = Math.abs(latest.lev_money_net_change) > lmThreshold;
  const oppositeSign = Math.sign(latest.asset_mgr_net_change) !== Math.sign(latest.lev_money_net_change);

  if (amMoved && lmMoved && oppositeSign && latest.asset_mgr_net_change !== 0 && latest.lev_money_net_change !== 0) {
    const amDir = latest.asset_mgr_net_change > 0 ? 'suma' : 'reduce';
    const lmDir = latest.lev_money_net_change > 0 ? 'suma' : 'reduce';
    alerts.push({
      kind: 'divergence',
      text: `Asset Mgr ${amDir} mientras Leveraged Funds ${lmDir} — posicionamiento divergente esta semana`,
      description: COT_ALERT_DESCRIPTIONS.divergence
    });
  }

  const amNets = sorted.map(e => e.asset_mgr_net);
  const lmNets = sorted.map(e => e.lev_money_net);
  if (latest.asset_mgr_net === Math.max(...amNets)) alerts.push({ kind: 'extreme', text: 'Asset Mgr en máximo de 52 semanas', description: COT_ALERT_DESCRIPTIONS.extreme });
  if (latest.asset_mgr_net === Math.min(...amNets)) alerts.push({ kind: 'extreme', text: 'Asset Mgr en mínimo de 52 semanas', description: COT_ALERT_DESCRIPTIONS.extreme });
  if (latest.lev_money_net === Math.max(...lmNets)) alerts.push({ kind: 'extreme', text: 'Leveraged Funds en máximo de 52 semanas', description: COT_ALERT_DESCRIPTIONS.extreme });
  if (latest.lev_money_net === Math.min(...lmNets)) alerts.push({ kind: 'extreme', text: 'Leveraged Funds en mínimo de 52 semanas', description: COT_ALERT_DESCRIPTIONS.extreme });

  return alerts;
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
  QQQ: 'Nasdaq 100',
  IWM: 'Russell 2000',
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

function formatShares(val: number | null | undefined): string {
  if (val === null || val === undefined || Number.isNaN(val)) return 'N/D';
  if (val >= 1.0e9) return `${(val / 1.0e9).toFixed(2)}B`;
  if (val >= 1.0e6) return `${(val / 1.0e6).toFixed(2)}M`;
  if (val >= 1.0e3) return `${(val / 1.0e3).toFixed(1)}K`;
  return `${val.toFixed(0)}`;
}

const FUND_FLOW_ALERTS_READ_KEY = 'fundFlowAlerts_readIds';

// Same bell/dropdown/unread-badge pattern as NotificationBell.tsx (used for
// Gamma Regime alerts) - kept local to this file since it's the only place
// fund-flow alerts render, instead of a shared component for a single user.
function FundFlowAlertsBell({ alerts }: { alerts: FundFlowAlert[] }) {
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(FUND_FLOW_ALERTS_READ_KEY);
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

  const sortedAlerts = [...alerts].sort((a, b) => b.date.localeCompare(a.date));
  const unreadCount = alerts.filter(a => !readIds.has(a.id)).length;

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next && unreadCount > 0) {
      const allIds = new Set([...Array.from(readIds), ...alerts.map(a => a.id)]);
      setReadIds(allIds);
      try {
        localStorage.setItem(FUND_FLOW_ALERTS_READ_KEY, JSON.stringify(Array.from(allIds)));
      } catch (e) {
        // ignore write failures (e.g. storage disabled)
      }
    }
  };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button onClick={handleToggle} style={bellButtonStyle} aria-label="Señales de divergencia precio/flujo">
        <Bell size={14} color={unreadCount > 0 ? '#fbbf24' : '#a1a1aa'} />
        {unreadCount > 0 && (
          <span style={bellBadgeStyle}>{unreadCount > 9 ? '9+' : unreadCount}</span>
        )}
      </button>

      {open && (
        <div style={bellDropdownStyle}>
          <div style={bellDropdownHeaderStyle}>Señales (divergencia precio / flujo)</div>
          <div style={{ maxHeight: '360px', overflowY: 'auto' }}>
            {sortedAlerts.length === 0 ? (
              <div style={bellEmptyStyle}>Sin señales por ahora.</div>
            ) : (
              sortedAlerts.map(a => {
                const isDistribution = a.type === 'QUIET_DISTRIBUTION';
                const color = isDistribution ? '#ff2a6d' : '#00e676';
                return (
                  <div key={a.id} style={bellAlertItemStyle}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.8rem', color }}>
                        {a.ticker} — {isDistribution ? 'Distribución silenciosa' : 'Acumulación silenciosa'}
                      </span>
                      <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.4)' }}>{a.date}</span>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.65)', marginTop: '4px', lineHeight: 1.4 }}>
                      {a.streak_days} sesiones de {isDistribution ? 'salida' : 'entrada'} neta ({formatMoney(a.net_flow_total)} acumulado)
                      {' '}mientras el precio {isDistribution ? 'se sostuvo' : 'no acompañó'} ({a.price_change_pct >= 0 ? '+' : ''}{a.price_change_pct.toFixed(2)}%).
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function FundFlowPanel({ sectorFlow, marketTide, cotPositioning, fundFlowAlerts, loading }: FundFlowPanelProps) {
  const [showCotInfo, setShowCotInfo] = useState(false);

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
  // Indices first (SPY, QQQ, IWM, in that fixed order since they're the
  // broad-market anchors), then every SPDR sector alphabetically by ticker.
  const INDEX_ORDER = ['SPY', 'QQQ', 'IWM'];
  const sortedSectors = [...sectorsWithLatest].sort((a, b) => {
    const aIdx = INDEX_ORDER.indexOf(a.ticker);
    const bIdx = INDEX_ORDER.indexOf(b.ticker);
    if (aIdx !== -1 || bIdx !== -1) {
      if (aIdx === -1) return 1;
      if (bIdx === -1) return -1;
      return aIdx - bIdx;
    }
    return a.ticker.localeCompare(b.ticker);
  });
  const netTide = marketTide ? marketTide.net_call_premium + marketTide.net_put_premium : null;
  const sectorWeekKeys = sharedWeekKeys(sortedSectors.map(s => s.history));

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
      levMoneySeries: cotChangeSeries(entries, 'lev_money_net_change'),
      alerts: computeCotAlerts(entries)
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h4 style={colHeaderStyle}>FLUJO NETO POR SECTOR (ETF, {SECTOR_WEEKS_WINDOW}SEM)</h4>
            <FundFlowAlertsBell alerts={fundFlowAlerts} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {sortedSectors.map(s => (
              <div key={s.ticker} style={sectorRowStyle}>
                <span style={{ ...sectorTickerStyle, flex: '0 0 88px' }}>
                  {s.ticker}
                  <span style={sectorLabelStyle}>{SECTOR_LABELS[s.ticker] ?? ''}</span>
                </span>
                <SectorFlowBars history={s.history} weekKeys={sectorWeekKeys} />
                {(() => {
                  const l = s.latest;
                  const pctChange = l?.last != null && l?.prev_close ? ((l.last - l.prev_close) / l.prev_close) * 100 : null;
                  const bullish = l?.bullish_premium ?? null;
                  const bearish = l?.bearish_premium ?? null;
                  const totalPrem = bullish != null && bearish != null ? bullish + bearish : null;
                  const bullPct = totalPrem ? (bullish! / totalPrem) * 100 : null;
                  return (
                    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px', flex: '0 0 110px', textAlign: 'right', marginLeft: 'auto' }}>
                      <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.75rem', alignSelf: 'center', color: pctChange == null ? 'rgba(255,255,255,0.3)' : pctChange >= 0 ? '#00e676' : '#ff2a6d' }}>
                        {pctChange == null ? 'N/D' : `${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(2)}%`}
                      </span>
                      {bullPct != null && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px', width: '100%' }}>
                          <span style={{ flex: 1, height: '6px', borderRadius: '3px', overflow: 'hidden', display: 'flex' }}>
                            <span style={{ width: `${100 - bullPct}%`, backgroundColor: '#ff2a6d' }} />
                            <span style={{ width: `${bullPct}%`, backgroundColor: '#00e676' }} />
                          </span>
                          <span style={{ fontSize: '0.6rem', color: '#00e676', fontFamily: 'monospace', fontWeight: 700, flexShrink: 0 }}>{bullPct.toFixed(0)}%</span>
                        </span>
                      )}
                      <span style={{ fontSize: '0.62rem', color: '#fbbf24' }}>vol {formatShares(l?.volume)}</span>
                    </span>
                  );
                })()}
              </div>
            ))}
          </div>
        </div>

        {/* COT Positioning */}
        <div style={{ ...colStyle, borderRight: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <h4 style={colHeaderStyle}>COT (CFTC, SEMANAL, 52W)</h4>
            <button onClick={() => setShowCotInfo(true)} style={infoButtonStyle} aria-label="¿Qué significan estos datos?">
              <Info size={12} />
            </button>
          </div>
          {showCotInfo && <CotInfoModal onClose={() => setShowCotInfo(false)} />}
          {cotInstruments.length === 0 ? (
            <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)' }}>Sin reporte todavía.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {cotInstruments.map(({ instrument, latest: c, assetMgrSeries, levMoneySeries, alerts }) => (
                <div key={instrument} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                    <span style={{ fontWeight: 700, marginLeft: '50px' }}>{instrument}</span>
                    <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.7rem' }}>{c.date}</span>
                  </div>
                  {alerts.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', marginLeft: '80px', gap: '3px' }}>
                      {alerts.map((a, i) => <CotAlertChip key={i} alert={a} />)}
                    </div>
                  )}
                  <div style={cotMetricBlockStyle}>
                    <div style={cotMetricHeaderStyle}>
                      <span style={{ ...labelStyle, marginLeft: '75px' }}>Asset Mgr</span>
                      <span style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
                        <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.8rem', color: c.asset_mgr_net >= 0 ? '#00e676' : '#ff2a6d' }}>
                          {c.asset_mgr_net.toLocaleString()}
                        </span>
                        <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.4)' }}>
                          ({formatContracts(c.asset_mgr_net_change)})
                        </span>
                      </span>
                    </div>
                    <div style={{ paddingLeft: '90px' }}>
                      <MetricBars
                        series={assetMgrSeries}
                        formatValue={formatContracts}
                        responsive
                        widthPercent={85}
                        height={COT_CHART_HEIGHT}
                        barWidth={COT_BAR_WIDTH}
                        barGap={COT_BAR_GAP}
                      />
                    </div>
                  </div>
                  <div style={cotMetricBlockStyle}>
                    <div style={cotMetricHeaderStyle}>
                      <span style={{ ...labelStyle, marginLeft: '75px' }}>Leveraged Funds</span>
                      <span style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
                        <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.8rem', color: c.lev_money_net >= 0 ? '#00e676' : '#ff2a6d' }}>
                          {c.lev_money_net.toLocaleString()}
                        </span>
                        <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.4)' }}>
                          ({formatContracts(c.lev_money_net_change)})
                        </span>
                      </span>
                    </div>
                    <div style={{ paddingLeft: '90px' }}>
                      <MetricBars
                        series={levMoneySeries}
                        formatValue={formatContracts}
                        responsive
                        widthPercent={85}
                        height={COT_CHART_HEIGHT}
                        barWidth={COT_BAR_WIDTH}
                        barGap={COT_BAR_GAP}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
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

// Sector Flow's row content (ticker + weekly bars + value) has a fixed,
// fairly narrow natural width - giving it an equal 1fr column like COT left
// a wide dead gap between the bars and the $ values. Capping it lets COT
// (which actually benefits from more room) take the rest.
const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(320px, 400px) minmax(320px, 1fr)',
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

const cotAlertChipStyle: React.CSSProperties = {
  fontSize: '0.68rem',
  fontWeight: 600,
  padding: '3px 8px',
  borderRadius: '5px',
  border: '1px solid',
  backgroundColor: 'rgba(255,255,255,0.03)',
  lineHeight: 1.4,
  width: 'fit-content'
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
  fontWeight: 700,
  // A fixed flex-basis alone doesn't stop a single unbreakable long word
  // (e.g. "Communication", "Discretionary") from forcing this box wider than
  // 88px, since a box can't render smaller than its content's min-content
  // width unless overflow is non-visible - and that overflow pushed every
  // sector's weekly bars sibling out of alignment with each other.
  overflow: 'hidden',
  minWidth: 0
};

const sectorLabelStyle: React.CSSProperties = {
  fontWeight: 400,
  fontSize: '0.7rem',
  overflowWrap: 'break-word',
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

const bellButtonStyle: React.CSSProperties = {
  position: 'relative',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '8px',
  width: '26px',
  height: '26px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer'
};

const bellBadgeStyle: React.CSSProperties = {
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

const bellDropdownStyle: React.CSSProperties = {
  position: 'absolute',
  top: '32px',
  right: 0,
  width: '320px',
  backgroundColor: 'rgba(10, 16, 35, 0.98)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '10px',
  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  zIndex: 200,
  overflow: 'hidden'
};

const bellDropdownHeaderStyle: React.CSSProperties = {
  padding: '10px 14px',
  fontSize: '0.75rem',
  fontWeight: 800,
  letterSpacing: '0.05em',
  color: '#a78bfa',
  borderBottom: '1px solid rgba(255,255,255,0.06)'
};

const bellAlertItemStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderBottom: '1px solid rgba(255,255,255,0.04)'
};

const bellEmptyStyle: React.CSSProperties = {
  padding: '20px 14px',
  fontSize: '0.75rem',
  color: 'rgba(255,255,255,0.4)',
  fontStyle: 'italic',
  textAlign: 'center'
};

const infoButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: '50%',
  color: 'rgba(255,255,255,0.5)',
  cursor: 'pointer',
  width: '18px',
  height: '18px',
  padding: 0
};

const infoOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  padding: '20px'
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
  fontWeight: 800,
  color: '#a78bfa'
};

const infoTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.78rem',
  lineHeight: 1.6,
  color: 'rgba(255,255,255,0.75)'
};
