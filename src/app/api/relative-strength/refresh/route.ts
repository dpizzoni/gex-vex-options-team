import { NextResponse } from 'next/server';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

// Triggers a real fetch+recompute (scripts/fetch-relative-strength.js,
// ~10-15s for 60 tickers via yahoo-finance2) instead of just re-reading the
// cache - this is what the dashboard's refresh button hits. Runs the script
// as a child process rather than `require`-ing it directly: webpack can't
// statically bundle a require() into a path outside src/ ("Critical
// dependency: the request of a dependency is an expression"), which made a
// direct require silently fail to resolve the module at runtime.
//
// Local/dev only for now: the script writes cache/*.json to disk via `fs`,
// which works against this repo's checkout but would fail against a
// read-only serverless filesystem (e.g. Vercel) - fine for the current
// local-only phase of this module, revisit if this ever needs to run there.
function runFetchScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'node',
      ['scripts/fetch-relative-strength.js'],
      { cwd: process.cwd(), timeout: 60_000 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr || stdout || err.message));
          return;
        }
        resolve();
      }
    );
  });
}

export async function POST() {
  try {
    await runFetchScript();
    const filePath = path.join(process.cwd(), 'cache', 'relative-strength.json');
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
