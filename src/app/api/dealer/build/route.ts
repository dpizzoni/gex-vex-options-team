import { NextResponse } from 'next/server';
import { runDealerBuilder } from '../../../../../../scripts/dealer-builder';

export async function POST() {
  try {
    const t0 = Date.now();
    
    // Ejecutamos la función directamente en lugar de usar un comando de consola.
    runDealerBuilder();
    
    const t1 = Date.now();

    return NextResponse.json({
      success: true,
      duration: (t1 - t0) / 1000,
      stdout: "Builder executed natively in Node.js"
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
