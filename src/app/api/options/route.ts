import { NextRequest, NextResponse } from 'next/server';
import YF from 'yahoo-finance2';
import { calcT, calcGamma, sanitizeIV, calcIVFromPrice, findGammaFlip } from '@/lib/gex-engine';

const yahooFinance = new YF({ suppressNotices: ['yahooSurvey'] });

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// fetchMatrixData (page.tsx) fires one request per expiration concurrently
// for the same symbol, so Yahoo Finance sees a burst of near-simultaneous
// calls - transient rate-limit/network hiccups there shouldn't have to fail
// the whole matrix load. One retry after a short backoff covers that without
// masking a genuinely broken symbol/expiration (which will still fail twice).
async function withRetry<T>(fn: () => Promise<T>, retries = 1, delayMs = 400): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (retries <= 0) throw err;
    await new Promise(resolve => setTimeout(resolve, delayMs));
    return withRetry(fn, retries - 1, delayMs);
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const symbol = searchParams.get('symbol');
  const expParam = searchParams.get('expiration');

  if (!symbol) {
    return NextResponse.json({ error: "Missing symbol" }, { status: 400 });
  }

  try {
    const quote = await withRetry(() => yahooFinance.quote(symbol)) as any;
    const spot = quote.regularMarketPrice || quote.ask || quote.bid;

    if (!spot) {
      return NextResponse.json({ error: `Could not retrieve spot price for ${symbol}` }, { status: 404 });
    }

    const resultWithExps = await withRetry(() => yahooFinance.options(symbol)) as any;
    if (!resultWithExps || !resultWithExps.expirationDates || resultWithExps.expirationDates.length === 0) {
      return NextResponse.json({ spot, symbol, expirations: [], calls: [], puts: [] });
    }

    const expirations = resultWithExps.expirationDates.map((d: Date) => d.toISOString().split('T')[0]).sort();

    const finalExp: string = (expParam && expirations.includes(expParam)) ? expParam : expirations[0];

    const chainData = await withRetry(() => yahooFinance.options(symbol, { date: new Date(finalExp) })) as any;
    const chain = chainData.options[0] || { calls: [], puts: [] };

    // AUDIT M1/M2 FIX: T unified via calcT (16:00 ET, DST-aware), r via RISK_FREE_RATE in engine
    const T = calcT(finalExp);

    // R1 — Phase 1: collect raw data per strike, keyed for O(1) lookup
    interface RawContract { rawIv: number; oi: number; vol: number; bid: number; ask: number; }
    const rawCallMap = new Map<number, RawContract>();
    const rawPutMap  = new Map<number, RawContract>();

    (chain.calls || []).forEach((c: any) => {
      rawCallMap.set(c.strike || 0, { rawIv: c.impliedVolatility || 0, oi: c.openInterest || 0, vol: c.volume || 0, bid: c.bid || 0, ask: c.ask || 0 });
    });
    (chain.puts || []).forEach((p: any) => {
      rawPutMap.set(p.strike || 0, { rawIv: p.impliedVolatility || 0, oi: p.openInterest || 0, vol: p.volume || 0, bid: p.bid || 0, ask: p.ask || 0 });
    });

    // R1 — Phase 2: build unified IV per strike via put-call parity.
    // OTM side has the most reliable price data; use its IV for both legs at the same strike.
    // Fallback: if OTM Yahoo IV is invalid, derive from mid-price via Newton-Raphson BS inversion.
    const unifiedIV = new Map<number, number>();
    const allStrikes = new Set([...rawCallMap.keys(), ...rawPutMap.keys()]);

    for (const strike of allStrikes) {
      const call = rawCallMap.get(strike);
      const put  = rawPutMap.get(strike);
      const callIsOtm = strike >= spot; // OTM: call when strike ≥ spot, put when strike < spot
      const otm = callIsOtm ? call : put;
      const itm = callIsOtm ? put  : call;

      let iv = 0;

      // Try OTM side first (most reliable for BS inversion)
      if (otm) {
        iv = sanitizeIV(otm.rawIv);
        if (iv === 0 && otm.bid > 0 && otm.ask > 0) {
          iv = calcIVFromPrice(spot, strike, T, (otm.bid + otm.ask) / 2, callIsOtm);
        }
      }

      // ITM fallback: if OTM side failed, try ITM (less ideal but better than nothing)
      if (iv === 0 && itm) {
        iv = sanitizeIV(itm.rawIv);
        if (iv === 0 && itm.bid > 0 && itm.ask > 0) {
          iv = calcIVFromPrice(spot, strike, T, (itm.bid + itm.ask) / 2, !callIsOtm);
        }
      }

      if (iv > 0) unifiedIV.set(strike, iv);
    }

    // R1 — Phase 3: format contracts using unified IV per strike.
    // Both call and put at the same strike share the OTM IV → γcall ≈ γput (parity guaranteed).
    let totalCallGex = 0;
    let totalPutGex = 0;

    const formatContract = (row: any, isCall: boolean) => {
      const strike = row.strike || 0;
      const raw    = isCall ? rawCallMap.get(strike) : rawPutMap.get(strike);
      const iv     = unifiedIV.get(strike) || 0;
      const oi     = raw?.oi  ?? 0;
      const gamma  = iv > 0 ? calcGamma(spot, strike, T, iv) : 0;
      const gex    = iv > 0 ? (isCall ? gamma : -gamma) * oi * spot * spot : 0;

      if (isCall) totalCallGex += gex;
      else        totalPutGex  += gex;

      return { strike, impliedVolatility: iv, openInterest: oi, volume: raw?.vol ?? 0, bid: raw?.bid ?? 0, ask: raw?.ask ?? 0, gamma, gex, vanna: 0.0, vex: 0 };
    };

    const calls = (chain.calls || []).map((c: any) => formatContract(c, true));
    const puts  = (chain.puts  || []).map((p: any) => formatContract(p, false));

    const strikeGexMap = new Map<number, number>();
    for (const c of calls) strikeGexMap.set(c.strike, (strikeGexMap.get(c.strike) || 0) + c.gex);
    for (const p of puts) strikeGexMap.set(p.strike, (strikeGexMap.get(p.strike) || 0) + p.gex);

    let kingNode = null;
    let maxAbsGex = -1;
    for (const [strike, val] of strikeGexMap.entries()) {
      if (Math.abs(val) > maxAbsGex) {
        maxAbsGex = Math.abs(val);
        kingNode = strike;
      }
    }

    const netGex = totalCallGex + totalPutGex;

    // AUDIT C7 FIX: closest crossing via engine (fixes first-crossing bug)
    const allContracts = [
      ...calls.map((c: any) => ({ ...c, type: 'CALL' as const, T })),
      ...puts.map((p: any) => ({ ...p, type: 'PUT' as const, T }))
    ];
    const gammaFlip = findGammaFlip(spot, allContracts);

    return NextResponse.json({
      spot, symbol, expirations, selectedExpiration: finalExp,
      calls, puts, kingNode, gammaFlip, vannaFlip: null,
      totalCallGex, totalPutGex, netGex,
      totalCallVex: 0, totalPutVex: 0, netVex: 0,
      dealerBias: { overall: "N/A", gexRegime: "N/A", vexRegime: "N/A" }
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
