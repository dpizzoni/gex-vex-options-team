// Shared GEX/VEX calculation engine — single source of truth for math and constants.
// All TypeScript consumers (route.ts, GammaMatrix.tsx, page.tsx) import from here.

export const RISK_FREE_RATE = 0.045;

// Options expire at 16:00 ET.
// R8 fix: detect DST by month — Apr–Oct = EDT (UTC-4) → 20:00 UTC; Nov–Mar = EST (UTC-5) → 21:00 UTC.
// March and November edge weeks may be off by ≤1h (acceptable; exact DST Sunday detection adds complexity).
export function calcT(expirationDateStr: string): number {
  const month = parseInt(expirationDateStr.slice(5, 7), 10);
  const closeUTC = (month >= 4 && month <= 10) ? "T20:00:00Z" : "T21:00:00Z";
  const expMs = new Date(`${expirationDateStr}${closeUTC}`).getTime();
  const T = Math.max(expMs - Date.now(), 0) / (365.25 * 24 * 3600 * 1000);
  return T > 0 ? T : 1e-5;
}

export function calcGamma(S: number, K: number, T: number, sigma: number): number {
  if (T <= 0 || sigma <= 0) return 0;
  const s = Math.max(sigma, 0.01);
  try {
    const d1 = (Math.log(S / K) + (RISK_FREE_RATE + 0.5 * s * s) * T) / (s * Math.sqrt(T));
    const pdf = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2.0 * Math.PI);
    return pdf / (S * s * Math.sqrt(T));
  } catch {
    return 0;
  }
}

// AUDIT C1 FIX: vanna = −φ(d1)·d2/σ — no extra √T factor.
export function calcVanna(S: number, K: number, T: number, sigma: number): number {
  if (T <= 0 || sigma <= 0) return 0;
  const s = Math.max(sigma, 0.01);
  try {
    const d1 = (Math.log(S / K) + (RISK_FREE_RATE + 0.5 * s * s) * T) / (s * Math.sqrt(T));
    const d2 = d1 - s * Math.sqrt(T);
    const pdf = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2.0 * Math.PI);
    const vanna = -(pdf * d2) / s;
    return Number.isFinite(vanna) ? vanna : 0;
  } catch {
    return 0;
  }
}

// AUDIT C4/C5 FIX: Yahoo delivers IV as decimal (0.20 = 20%). Valid range [3%, 400%].
export function sanitizeIV(rawIv: number): number {
  return (rawIv >= 0.03 && rawIv <= 4.0) ? rawIv : 0;
}

// Standard normal CDF — Abramowitz & Stegun 26.2.17, max error 7.5e-8.
function normalCDF(x: number): number {
  const b1 = 0.319381530, b2 = -0.356563782, b3 = 1.781477937;
  const b4 = -1.821255978, b5 = 1.330274429, p = 0.2316419;
  const phi = Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  const t = 1 / (1 + p * Math.abs(x));
  const poly = t * (b1 + t * (b2 + t * (b3 + t * (b4 + t * b5))));
  const upper = 1 - phi * poly;
  return x >= 0 ? upper : 1 - upper;
}

// Black-Scholes theoretical price for European call or put.
export function bsPrice(S: number, K: number, T: number, sigma: number, isCall: boolean): number {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) {
    return Math.max(0, isCall ? S - K * Math.exp(-RISK_FREE_RATE * T) : K * Math.exp(-RISK_FREE_RATE * T) - S);
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (RISK_FREE_RATE + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const df = Math.exp(-RISK_FREE_RATE * T);
  return isCall
    ? S * normalCDF(d1) - K * df * normalCDF(d2)
    : K * df * normalCDF(-d2) - S * normalCDF(-d1);
}

// R1: Newton-Raphson IV solver from mid-price (bid+ask)/2.
// Returns IV in decimal [0.03, 4.0] or 0 if no solution found.
export function calcIVFromPrice(S: number, K: number, T: number, midPrice: number, isCall: boolean): number {
  if (T <= 0 || midPrice <= 0 || S <= 0 || K <= 0) return 0;
  const df = Math.exp(-RISK_FREE_RATE * T);
  const intrinsic = Math.max(0, isCall ? S - K * df : K * df - S);
  if (midPrice < intrinsic - 0.01) return 0; // price below intrinsic — corrupt data

  // Brenner-Subrahmanyam ATM seed: sigma ≈ sqrt(2π/T) * price/S
  let sigma = Math.max(0.05, Math.sqrt(2 * Math.PI / T) * midPrice / S);

  for (let i = 0; i < 100; i++) {
    const price = bsPrice(S, K, T, sigma, isCall);
    const d1 = (Math.log(S / K) + (RISK_FREE_RATE + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
    const vega = S * Math.sqrt(T) * Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);
    if (vega < 1e-12) break;
    const diff = price - midPrice;
    if (Math.abs(diff) < 1e-6) break;
    sigma -= diff / vega;
    if (sigma < 0.005) sigma = 0.005;
    if (sigma > 5.0) { sigma = 5.0; break; }
  }

  return sanitizeIV(sigma);
}

// AUDIT C7 FIX: returns the crossing CLOSEST to spot, not the first found.
export function findGammaFlip(
  spot: number,
  contracts: Array<{ strike: number; impliedVolatility: number; openInterest: number; type: 'CALL' | 'PUT'; T: number }>
): number | null {
  const getNetGex = (S: number) => contracts.reduce((sum, opt) => {
    const sigma = sanitizeIV(opt.impliedVolatility);
    if (sigma === 0) return sum;
    const g = calcGamma(S, opt.strike, opt.T, sigma);
    return sum + (opt.type === 'CALL' ? 1 : -1) * g * opt.openInterest * S * S;
  }, 0);

  const spotMin = spot * 0.8;
  const stepSize = (spot * 1.2 - spotMin) / 40;
  const crosses: number[] = [];

  let sPrev = spotMin;
  let gexPrev = getNetGex(sPrev);

  for (let i = 1; i <= 40; i++) {
    const sCurr = spotMin + i * stepSize;
    const gexCurr = getNetGex(sCurr);
    if ((gexPrev < 0 && gexCurr >= 0) || (gexPrev > 0 && gexCurr <= 0)) {
      const gexLeft = gexPrev;
      let lo = sPrev, hi = sCurr;
      for (let j = 0; j < 8; j++) {
        const mid = (lo + hi) / 2;
        const gexMid = getNetGex(mid);
        if (gexMid === 0) { lo = mid; break; }
        else if ((gexLeft < 0 && gexMid < 0) || (gexLeft > 0 && gexMid > 0)) lo = mid;
        else hi = mid;
      }
      crosses.push((lo + hi) / 2);
    }
    sPrev = sCurr;
    gexPrev = gexCurr;
  }

  return crosses.length > 0
    ? crosses.reduce((best, c) => Math.abs(c - spot) < Math.abs(best - spot) ? c : best)
    : null;
}
