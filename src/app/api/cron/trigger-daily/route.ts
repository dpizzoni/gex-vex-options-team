import { NextRequest, NextResponse } from "next/server";

const GITHUB_OWNER = "dpizzoni";
const GITHUB_REPO = "gex-vex-options-team";
const WORKFLOW_FILE = "daily-update.yml";

// Fires the same workflow_dispatch event the "Run workflow" button in GitHub
// Actions triggers, but at an exact time instead of waiting on GitHub's
// `schedule:` trigger (which can lag by up to a few hours under load).
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = process.env.GH_DISPATCH_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "GH_DISPATCH_TOKEN not configured" }, { status: 500 });
  }

  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref: "main" }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    return NextResponse.json({ error: "GitHub dispatch failed", status: res.status, body }, { status: 502 });
  }

  return NextResponse.json({ ok: true, dispatchedAt: new Date().toISOString() });
}
