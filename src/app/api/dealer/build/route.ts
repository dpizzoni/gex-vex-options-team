import { NextResponse } from 'next/server';

export async function POST() {
  // Evitar ejecutar reconstrucción en producción (Vercel) ya que el sistema de archivos es de solo lectura
  if (process.env.VERCEL) {
    return NextResponse.json({ 
      success: false, 
      error: "La reconstrucción manual no está disponible en producción (Vercel). GitHub Actions actualiza los datos automáticamente cada día." 
    }, { status: 400 });
  }

  try {
    const t0 = Date.now();
    
    // @ts-ignore
    const { runDealerBuilder } = await import('../../../../../../scripts/dealer-builder');
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
