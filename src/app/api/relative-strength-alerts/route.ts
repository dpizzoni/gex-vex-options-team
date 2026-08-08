import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET() {
  const filePath = path.join(process.cwd(), 'cache', 'relative-strength-alerts.json');

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({
      date: null,
      generatedAt: null,
      buckets: { liderazgo: [], rotacion: [], confirmacion: [], persistencia: [] }
    });
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
