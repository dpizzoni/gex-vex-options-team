import { NextRequest, NextResponse } from 'next/server';

// Half-life for EMA: 45 minutes. After 45 min without a king change, ema decays to 0.5.
const HALF_LIFE_MS = 45 * 60 * 1000;
const MAX_HISTORY = 60; // ~5 hours at 5-min refresh intervals

interface Snapshot {
  timestamp: number;
  king: number;
  spot: number;
  netGex: number;
  ema: number;
}

// Module-level store — persists for the lifetime of the Next.js server process.
const store = new Map<string, Snapshot[]>();

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { symbol, exp, king, spot, netGex } = body;

  if (!symbol || !exp || king == null || spot == null) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const key = `${symbol}_${exp}`;
  const history = store.get(key) ?? [];

  const now = Date.now();
  let ema = 0.5;
  let prevSpot: number | null = null;

  if (history.length > 0) {
    const prev = history[history.length - 1];
    prevSpot = prev.spot;
    const deltaMs = Math.max(now - prev.timestamp, 1);
    // Continuous-time EMA: decay = exp(-Δt * ln2 / half_life)
    const decay = Math.exp(-(deltaMs * Math.LN2) / HALF_LIFE_MS);
    const indicator = king === prev.king ? 1 : 0;
    ema = decay * prev.ema + (1 - decay) * indicator;
  }

  const snap: Snapshot = { timestamp: now, king, spot, netGex: netGex ?? 0, ema };
  let updated = [...history, snap];
  if (updated.length > MAX_HISTORY) updated = updated.slice(updated.length - MAX_HISTORY);
  store.set(key, updated);

  // Consecutive same-king count from the end
  let count = 0;
  for (let i = updated.length - 1; i >= 0; i--) {
    if (updated[i].king === king) count++;
    else break;
  }

  // Last different king (for "changed from" display)
  let prevKing: number | null = null;
  for (let i = updated.length - 2; i >= 0; i--) {
    if (updated[i].king !== king) {
      prevKing = updated[i].king;
      break;
    }
  }

  return NextResponse.json({ ema, prevSpot, count, prevKing });
}
