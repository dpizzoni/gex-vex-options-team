import { NextResponse } from 'next/server';
import { loadDealer } from '@/lib/dealer-engine';

export const dynamic = 'force-dynamic';

export async function GET() {
  const dealerMap = loadDealer();
  const obj = Object.fromEntries(dealerMap);
  return NextResponse.json(obj);
}
