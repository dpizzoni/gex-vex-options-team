import { NextRequest, NextResponse } from 'next/server';
import YF from 'yahoo-finance2';
import { calcT, calcGamma, sanitizeIV, findGammaFlip } from '@/lib/gex-engine';

const yahooFinance = new YF({ suppressNotices: ['yahooSurvey'] });

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const symbol = searchParams.get('symbol');
  const expParam = searchParams.get('expiration');

  if (!symbol) {
    return NextResponse.json({ error: "Missing symbol" }, { status: 400 });
  }

  try {
    const quote = await yahooFinance.quote(symbol) as any;
    const spot = quote.regularMarketPrice || quote.ask || quote.bid;

    if (!spot) {
      return NextResponse.json({ error: `Could not retrieve spot price for ${symbol}` }, { status: 404 });
    }

    const resultWithExps = await yahooFinance.options(symbol) as any;
    if (!resultWithExps || !resultWithExps.expirationDates || resultWithExps.expirationDates.length === 0) {
      return NextResponse.json({ spot, symbol, expirations: [], calls: [], puts: [] });
    }

    const expirations = resultWithExps.expirationDates.map((d: Date) => d.toISOString().split('T')[0]).sort();

    const finalExp: string = (expParam && expirations.includes(expParam)) ? expParam : expirations[0];

    const chainData = await yahooFinance.options(symbol, { date: new Date(finalExp) }) as any;
    const chain = chainData.options[0] || { calls: [], puts: [] };

    // AUDIT M1/M2 FIX: T unified via calcT (16:00 ET), r via RISK_FREE_RATE in engine
    const T = calcT(finalExp);

    let totalCallGex = 0;
    let totalPutGex = 0;

    const formatContract = (row: any, isCall: boolean) => {
      const strike = row.strike || 0;
      const rawIv = row.impliedVolatility || 0;
      const oi = row.openInterest || 0;
      const vol = row.volume || 0;
      const bid = row.bid || 0;
      const ask = row.ask || 0;

      // AUDIT C4 FIX: sanitize IV — valid range [3%, 400%] in decimal
      const iv = sanitizeIV(rawIv);
      const gamma = iv > 0 ? calcGamma(spot, strike, T, iv) : 0;
      const gex = iv > 0 ? (isCall ? gamma : -gamma) * oi * Math.pow(spot, 2) : 0;

      if (isCall) totalCallGex += gex;
      else totalPutGex += gex;

      return { strike, impliedVolatility: iv, openInterest: oi, volume: vol, bid, ask, gamma, gex, vanna: 0.0, vex: 0 };
    };

    const calls = (chain.calls || []).map((c: any) => formatContract(c, true));
    const puts = (chain.puts || []).map((p: any) => formatContract(p, false));

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
