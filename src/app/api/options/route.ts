import { NextRequest, NextResponse } from 'next/server';
import yahooFinance from 'yahoo-finance2';

export const dynamic = 'force-dynamic';

function calculateGamma(S: number, K: number, T: number, r: number, sigma: number): number {
  if (T <= 0) T = 1e-5;
  sigma = Math.max(sigma, 0.01);
  try {
    const d1 = (Math.log(S / K) + (r + 0.5 * Math.pow(sigma, 2)) * T) / (sigma * Math.sqrt(T));
    const pdf = Math.exp(-0.5 * Math.pow(d1, 2)) / Math.sqrt(2.0 * Math.PI);
    return pdf / (S * sigma * Math.sqrt(T));
  } catch {
    return 0.0;
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
    const quote = await yahooFinance.quote(symbol) as any;
    const spot = quote.regularMarketPrice || quote.ask || quote.bid;

    if (!spot) {
      return NextResponse.json({ error: `Could not retrieve spot price for ${symbol}` }, { status: 404 });
    }

    const resultWithExps = await yahooFinance.options(symbol) as any;
    if (!resultWithExps || !resultWithExps.expirationDates || resultWithExps.expirationDates.length === 0) {
      return NextResponse.json({ spot, expirations: [], calls: [], puts: [] });
    }

    const expirations = resultWithExps.expirationDates.map((d: Date) => d.toISOString().split('T')[0]).sort();

    let selectedExp = expParam;
    if (!selectedExp || !expirations.includes(selectedExp)) {
      selectedExp = expirations[0];
    }

    const chainData = await yahooFinance.options(symbol, { date: new Date(selectedExp) }) as any;
    const chain = chainData.options[0] || { calls: [], puts: [] };

    const expDate = new Date(selectedExp);
    const today = new Date();
    const daysToExpiration = Math.max((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24), 0.5);
    const T = daysToExpiration / 365.25;
    const r = 0.045;

    let totalCallGex = 0;
    let totalPutGex = 0;

    const formatContract = (row: any, isCall: boolean) => {
      const strike = row.strike || 0;
      const iv = row.impliedVolatility || 0;
      const oi = row.openInterest || 0;
      const vol = row.volume || 0;
      const bid = row.bid || 0;
      const ask = row.ask || 0;

      const gamma = calculateGamma(spot, strike, T, r, iv);
      const gex = (isCall ? gamma : -gamma) * oi * Math.pow(spot, 2);
      
      if (isCall) totalCallGex += gex;
      else totalPutGex += gex;

      return {
        strike,
        impliedVolatility: iv,
        openInterest: oi,
        volume: vol,
        bid,
        ask,
        gamma,
        gex,
        vanna: 0.0,
        vex: 0
      };
    };

    const calls = (chain.calls || []).map(c => formatContract(c, true));
    const puts = (chain.puts || []).map(p => formatContract(p, false));

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

    const getNetGexAtS = (sTest: number) => {
      let gexSum = 0;
      for (const c of calls) gexSum += calculateGamma(sTest, c.strike, T, r, c.impliedVolatility) * c.openInterest * Math.pow(sTest, 2);
      for (const p of puts) gexSum -= calculateGamma(sTest, p.strike, T, r, p.impliedVolatility) * p.openInterest * Math.pow(sTest, 2);
      return gexSum;
    };

    let gammaFlip = null;
    const spotMin = spot * 0.8;
    const spotMax = spot * 1.2;
    const steps = 40;
    const stepSize = (spotMax - spotMin) / steps;

    let sPrev = spotMin;
    let gexPrev = getNetGexAtS(sPrev);

    for (let i = 1; i <= steps; i++) {
      const sCurr = spotMin + i * stepSize;
      const gexCurr = getNetGexAtS(sCurr);
      if ((gexPrev < 0 && gexCurr >= 0) || (gexPrev > 0 && gexCurr <= 0)) {
        let lowS = sPrev;
        let highS = sCurr;
        for (let j = 0; j < 8; j++) {
          const midS = (lowS + highS) / 2.0;
          const gexMid = getNetGexAtS(midS);
          if (gexMid === 0) {
            lowS = midS;
            break;
          } else if ((gexPrev < 0 && gexMid < 0) || (gexPrev > 0 && gexMid > 0)) {
            lowS = midS;
          } else {
            highS = midS;
          }
        }
        gammaFlip = (lowS + highS) / 2.0;
        break;
      }
      sPrev = sCurr;
      gexPrev = gexCurr;
    }

    return NextResponse.json({
      spot,
      expirations,
      selectedExpiration: selectedExp,
      calls,
      puts,
      kingNode,
      gammaFlip,
      vannaFlip: null,
      totalCallGex,
      totalPutGex,
      netGex,
      totalCallVex: 0,
      totalPutVex: 0,
      netVex: 0,
      dealerBias: { overall: "N/A", gexRegime: "N/A", vexRegime: "N/A" }
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
