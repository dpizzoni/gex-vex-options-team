// Shared GEX/VEX calculation engine — single source of truth for math and constants.
// All TypeScript consumers (route.ts, GammaMatrix.tsx, page.tsx) import from here.

export const RISK_FREE_RATE = 0.045;

// Options expire at 16:00 ET = 20:30 UTC (approximation that avoids DST branching).
// Using 20:30 UTC rather than midnight UTC fixes a ~8-hour error in T for 0DTE.
export function calcT(expirationDateStr: string): number {
  const expMs = new Date(`${expirationDateStr}T20:30:00Z`).getTime();
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
