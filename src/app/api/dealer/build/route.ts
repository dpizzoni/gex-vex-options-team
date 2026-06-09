import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

export async function POST() {
  try {
    const t0 = Date.now();
    const { stdout, stderr } = await execPromise('npm run dealer:build');
    const t1 = Date.now();

    return NextResponse.json({
      success: true,
      duration: (t1 - t0) / 1000,
      stdout
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
