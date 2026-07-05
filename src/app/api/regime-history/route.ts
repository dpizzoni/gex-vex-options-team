import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const symbol = searchParams.get('symbol');

  if (!symbol) {
    return NextResponse.json({ error: "Missing symbol" }, { status: 400 });
  }

  const ticker = symbol.toUpperCase();
  const filePath = path.join(process.cwd(), 'cache', `regime-history-${ticker}.json`);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({
      ticker,
      history: []
    });
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return NextResponse.json({
      ticker,
      history: data
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
