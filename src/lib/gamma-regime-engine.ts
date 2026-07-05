export interface RegimeHistoryEntry {
  date: string;
  ticker: string;
  spot: number;
  call_gex: number;
  put_gex: number;
  net_gex: number;
  call_vex: number;
  put_vex: number;
  net_vex: number;
  king_node: number;
  ema3_net_gex: number;
}

export interface ForwardExpirationEntry {
  expiration: string;
  dte?: number;
  call_gex: number;
  put_gex: number;
  net_gex: number;
  p_c_ratio: number;
}

export interface GammaRegimeAlert {
  type: "LONG_GAMMA_ENTRY" | "SHORT_GAMMA_ENTRY" | "EXTREME_NEGATIVE" | "EXTREME_POSITIVE" | "FORWARD_REGIME_PRESSURE";
  title: string;
  description: string;
}

export interface GammaRegimeOutput {
  regime: "LONG_GAMMA" | "SHORT_GAMMA";
  quadrant: string;
  duration: number;
  shiftStrengthNorm: number;
  shiftStrengthDesc: string;
  stabilityScore: number;
  stabilityDesc: string;
  netGexToday: number;
  deltaGex: number;
  ema3NetGex: number;
  
  // Forward signal
  forwardRegime: string;
  daysToPressure: number;
  pcForwardTrend: number;
  pressureExpirationDate: string;
  pressureExpirationGex: number;
  
  // Alerts
  alerts: GammaRegimeAlert[];
}

function getPercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (percentile / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export function computeGammaRegime(
  history: RegimeHistoryEntry[],
  forwardExpirations: ForwardExpirationEntry[],
  currentSpot: number,
  gridStep?: number
): GammaRegimeOutput | null {
  if (history.length < 20) {
    return null;
  }

  // Sort history chronologically just in case
  const sortedHistory = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const n = sortedHistory.length;
  const todayEntry = sortedHistory[n - 1];
  const yesterdayEntry = sortedHistory[n - 2];
  
  const ticker = todayEntry.ticker;
  const netGexToday = todayEntry.net_gex;
  const netGexYesterday = yesterdayEntry.net_gex;
  const ema3NetGex = todayEntry.ema3_net_gex;
  const spot = todayEntry.spot;
  const netVexToday = todayEntry.net_vex;
  const kingNode = todayEntry.king_node;

  // 1. Regime Identification
  const regime = ema3NetGex >= 0 ? "LONG_GAMMA" : "SHORT_GAMMA";
  const prevRegime = yesterdayEntry.ema3_net_gex >= 0 ? "LONG_GAMMA" : "SHORT_GAMMA";

  // 2. Delta GEX
  const deltaGex = netGexToday - netGexYesterday;

  // 3. Rolling Calculations (30 days)
  const window30d = sortedHistory.slice(-30);
  const absNetGex30d = window30d.map(h => Math.abs(h.net_gex));
  const rollingAvgAbsNetGex30d = absNetGex30d.reduce((sum, val) => sum + val, 0) / absNetGex30d.length;

  const thresholdMinimo = 0.10 * rollingAvgAbsNetGex30d;

  // 4. Regime Shift
  const regimeShift = regime !== prevRegime && Math.abs(ema3NetGex) > thresholdMinimo;

  // 5. Shift Strength
  const shiftStrengthNorm = Math.abs(deltaGex) / (rollingAvgAbsNetGex30d || 1);
  let shiftStrengthDesc = "Bajo";
  if (shiftStrengthNorm >= 2.5) {
    shiftStrengthDesc = "Extremo";
  } else if (shiftStrengthNorm >= 1.0) {
    shiftStrengthDesc = "Alto";
  } else if (shiftStrengthNorm >= 0.25) {
    shiftStrengthDesc = "Moderado";
  }

  // 6. Regime Duration
  let regimeDuration = 1;
  for (let i = n - 2; i >= 0; i--) {
    const entryRegime = sortedHistory[i].ema3_net_gex >= 0 ? "LONG_GAMMA" : "SHORT_GAMMA";
    if (entryRegime === regime) {
      regimeDuration++;
    } else {
      break;
    }
  }

  // 7. Gamma Stability Score (20 days rolling)
  const window20d = sortedHistory.slice(-20);
  let sessionsSameRegime = 0;
  window20d.forEach(h => {
    const hRegime = h.ema3_net_gex >= 0 ? "LONG_GAMMA" : "SHORT_GAMMA";
    if (hRegime === regime) {
      sessionsSameRegime++;
    }
  });
  const stabilityScore = sessionsSameRegime / 20;
  let stabilityDesc = "Muy inestable";
  if (stabilityScore >= 0.80) {
    stabilityDesc = "Muy estable";
  } else if (stabilityScore >= 0.50) {
    stabilityDesc = "Estable";
  } else if (stabilityScore >= 0.20) {
    stabilityDesc = "Inestable";
  }

  // 8. VEX Pressure & Quadrant GEX-VEX
  const epsilon = 1e-4;
  const vexPressure = Math.abs(netVexToday) / Math.max(Math.abs(netGexToday), epsilon);
  
  let quadrant = "";
  if (regime === "LONG_GAMMA") {
    if (vexPressure < 0.05) {
      quadrant = "Pin Estable";
    } else if (vexPressure > 0.20) {
      quadrant = "Pin Frágil";
    } else {
      quadrant = "Pin de Transición";
    }
  } else {
    if (vexPressure < 0.05) {
      quadrant = "Direccional Controlado";
    } else if (vexPressure > 0.20) {
      quadrant = "Aceleración Explosiva";
    } else {
      quadrant = "Direccional Activo";
    }
  }

  // Determine actual grid step
  let step = gridStep;
  if (!step) {
    if (ticker === 'SPY' || ticker === 'QQQ') step = 1.0;
    else if (ticker === 'TSLA' || ticker === 'GOOGL') step = 5.0;
    else step = 1.0;
  }

  // 9. Percentiles & Extremes
  const netGexValues30d = window30d.map(h => h.net_gex);
  const p10NetGex = getPercentile(netGexValues30d, 10);
  const p90NetGex = getPercentile(netGexValues30d, 90);

  // VEX delta for last 10 days
  const window10d = sortedHistory.slice(-11);
  const vexDeltas10d = [];
  for (let i = 1; i < window10d.length; i++) {
    vexDeltas10d.push(Math.abs(window10d[i].net_vex - window10d[i - 1].net_vex));
  }
  const avgAbsVexDelta = vexDeltas10d.length > 0 
    ? vexDeltas10d.reduce((sum, val) => sum + val, 0) / vexDeltas10d.length 
    : 0;

  // delta_net_vex > 0 for 2+ consecutive days:
  let vexIncreasing2Days = false;
  if (n >= 3) {
    const deltaVexToday = sortedHistory[n - 1].net_vex - sortedHistory[n - 2].net_vex;
    const deltaVexYesterday = sortedHistory[n - 2].net_vex - sortedHistory[n - 3].net_vex;
    vexIncreasing2Days = deltaVexToday > 0 && deltaVexYesterday > 0;
  }

  // 10. Forward Inferences (UW table)
  let forwardRegime = regime;
  let daysToPressure = 0;
  let pcForwardTrend = 1.0;
  let pressureExpirationDate = "";
  let pressureExpirationGex = 0;

  if (forwardExpirations && forwardExpirations.length > 0) {
    // Net GEX forward accumulated (excluding first expiration)
    const forwardExcludingFirst = forwardExpirations.slice(1);
    const netGexForward = forwardExcludingFirst.reduce((sum, e) => sum + e.net_gex, 0);
    
    if (Math.sign(netGexForward) !== Math.sign(netGexToday) && Math.sign(netGexForward) !== 0) {
      forwardRegime = netGexForward >= 0 ? "presión hacia LONG_GAMMA" : "presión hacia SHORT_GAMMA";
    } else {
      forwardRegime = regime === "LONG_GAMMA" ? "LONG_GAMMA sostenido" : "SHORT_GAMMA sostenido";
    }

    // Days to pressure: sessions until expiration with max absolute GEX expires
    let maxAbsGexExpIndex = 0;
    let maxAbsGexVal = -1;
    forwardExpirations.forEach((e, idx) => {
      if (Math.abs(e.net_gex) > maxAbsGexVal) {
        maxAbsGexVal = Math.abs(e.net_gex);
        maxAbsGexExpIndex = idx;
      }
    });

    const pressureExp = forwardExpirations[maxAbsGexExpIndex];
    pressureExpirationDate = pressureExp.expiration;
    pressureExpirationGex = pressureExp.net_gex;

    // Convert calendar days to trading days (estimate 5/7 of calendar days)
    const expDate = new Date(pressureExpirationDate);
    const today = new Date();
    const diffTime = Math.max(0, expDate.getTime() - today.getTime());
    const diffCalendarDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    daysToPressure = Math.max(1, Math.round(diffCalendarDays * (5 / 7)));

    // P/C forward trend: average of p_c_ratio of the next 3 expirations
    const next3 = forwardExpirations.slice(0, 3);
    const pcSum = next3.reduce((sum, e) => sum + e.p_c_ratio, 0);
    pcForwardTrend = next3.length > 0 ? pcSum / next3.length : 1.0;
  }

  // 11. Alerts compilation
  const alerts: GammaRegimeAlert[] = [];

  // Alerta 1: LONG GAMMA ENTRY
  if (regimeShift && regime === "LONG_GAMMA") {
    alerts.push({
      type: "LONG_GAMMA_ENTRY",
      title: `[LONG GAMMA ENTRY]`,
      description: `Ticker: ${ticker} | ${todayEntry.date}\n\nEl activo entró en régimen LONG GAMMA.\nShift Strength: ${shiftStrengthDesc} (${shiftStrengthNorm.toFixed(2)}x)\n\nEsperar:\n- menor volatilidad realizada\n- mayor absorción intradía\n- probabilidad elevada de pinning near King Node (${kingNode})\n- menor sensibilidad a noticias\n- mayor probabilidad de reversión intradía ante movimientos bruscos`
    });
  }

  // Alerta 2: SHORT GAMMA ENTRY
  if (regimeShift && regime === "SHORT_GAMMA") {
    alerts.push({
      type: "SHORT_GAMMA_ENTRY",
      title: `[SHORT GAMMA ENTRY]`,
      description: `Ticker: ${ticker} | ${todayEntry.date}\n\nEl activo entró en régimen SHORT GAMMA.\nShift Strength: ${shiftStrengthDesc} (${shiftStrengthNorm.toFixed(2)}x)\n\nEsperar:\n- expansión de volatilidad realizada\n- mayor probabilidad de trend days sostenidos\n- ruptura más fácil de soportes y resistencias técnicas\n- mayor sensibilidad a noticias y catalizadores\n- mayor probabilidad de gaps con seguimiento`
    });
  }

  // Alerta 3: EXTREME NEGATIVE GAMMA
  const isExtremeNegative = netGexToday < p10NetGex && 
                            Math.abs(spot - kingNode) > 2 * step && 
                            vexIncreasing2Days;
  if (isExtremeNegative) {
    const pct = (netGexValues30d.filter(v => v < netGexToday).length / netGexValues30d.length) * 100;
    const distKing = Math.abs(spot - kingNode);
    const nGrids = distKing / step;
    
    alerts.push({
      type: "EXTREME_NEGATIVE",
      title: `[EXTREME NEGATIVE GAMMA]`,
      description: `Ticker: ${ticker} | ${todayEntry.date}\n\nEstructura compatible con evento de aceleración.\n\nNet GEX: ${formatGexValue(netGexToday)} (percentil ${pct.toFixed(0)}% histórico 30d)\nDistancia al King: ${distKing.toFixed(1)} pts (${nGrids.toFixed(1)}x gridStep)\nVEX aumentando: 2+ sesiones consecutivas\n\nLa combinación de gamma negativo extremo + spot alejado del King + presión VEX creciente es la estructura más propensa a movimientos violentos si aparece un catalizador.`
    });
  }

  // Alerta 4: EXTREME POSITIVE GAMMA — PIN ALERT
  const isExtremePositive = netGexToday > p90NetGex && 
                            Math.abs(spot - kingNode) < 1 * step;
  if (isExtremePositive) {
    const pct = (netGexValues30d.filter(v => v < netGexToday).length / netGexValues30d.length) * 100;
    const distKing = Math.abs(spot - kingNode);
    
    alerts.push({
      type: "EXTREME_POSITIVE",
      title: `[EXTREME POSITIVE GAMMA — PIN ALERT]`,
      description: `Ticker: ${ticker} | ${todayEntry.date}\n\nEstructura compatible con evento de pinning.\n\nNet GEX: ${formatGexValue(netGexToday)} (percentil ${pct.toFixed(0)}% histórico 30d)\nDistancia al King: ${distKing.toFixed(1)} pts\n\nLa estructura favorece máxima absorción alrededor del King Node (${kingNode}). Probabilidad elevada de cierre de sesión cerca de ese nivel.`
    });
  }

  // Alerta 5: FORWARD REGIME PRESSURE
  if (forwardExpirations && forwardExpirations.length > 0) {
    const forwardExcludingFirst = forwardExpirations.slice(1);
    const netGexForward = forwardExcludingFirst.reduce((sum, e) => sum + e.net_gex, 0);
    const signForward = Math.sign(netGexForward);
    const signToday = Math.sign(netGexToday);
    
    const isForwardPressure = signForward !== signToday && 
                             signForward !== 0 &&
                             (pcForwardTrend > 1.2 || pcForwardTrend < 0.8) && 
                             daysToPressure <= 5;
                             
    if (isForwardPressure) {
      const regimeOpuesto = regime === "LONG_GAMMA" ? "SHORT_GAMMA" : "LONG_GAMMA";
      alerts.push({
        type: "FORWARD_REGIME_PRESSURE",
        title: `[FORWARD REGIME PRESSURE]`,
        description: `Ticker: ${ticker} | ${todayEntry.date}\n\nLa estructura forward anticipa presión hacia cambio de régimen.\n\nRégimen actual:      ${regime}\nPresión forward:     hacia ${regimeOpuesto}\nDías hasta presión:  ${daysToPressure} sesiones\nP/C forward:         ${pcForwardTrend.toFixed(2)}\n\nInterpretación:\nAl vencer la expiración del ${pressureExpirationDate} (GEX: ${formatGexValue(pressureExpirationGex)}), la estructura de dealer podría cambiar de régimen. Esto no es una predicción de precio. Es una advertencia de que el entorno operativo puede cambiar próximamente.`
      });
    }
  }

  return {
    regime,
    quadrant,
    duration: regimeDuration,
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
  };
}

function formatGexValue(val: number): string {
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
}
