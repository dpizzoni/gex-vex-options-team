import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET() {
  const filePath = path.join(process.cwd(), 'cache', 'regime-alerts.json');

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ alerts: [] });
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return NextResponse.json({ alerts: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
