import { NextResponse } from "next/server";

const GITHUB_OWNER = "dpizzoni";
const GITHUB_REPO = "gex-vex-options-team";
const WORKFLOW_FILE = "daily-update.yml";

// Reports the most recent completed run of the daily UW capture workflow,
// straight from the GitHub Actions API, so the dashboard shows the real
// scrape time + duration (not a locally-written timestamp that could be
// stale or wrong if the workflow partially failed).
export async function GET() {
  const token = process.env.GH_DISPATCH_TOKEN;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/runs?status=completed&per_page=1`,
    { headers, next: { revalidate: 300 } }
  );

  if (!res.ok) {
    return NextResponse.json({ ranAt: null, durationSeconds: null, conclusion: null });
  }

  const body = await res.json();
  const run = body.workflow_runs?.[0];
  if (!run) {
    return NextResponse.json({ ranAt: null, durationSeconds: null, conclusion: null });
  }

  const startedAt = new Date(run.run_started_at);
  const updatedAt = new Date(run.updated_at);
  const durationSeconds = Math.max(0, Math.round((updatedAt.getTime() - startedAt.getTime()) / 1000));

  return NextResponse.json({
    ranAt: run.run_started_at,
    durationSeconds,
    conclusion: run.conclusion,
    htmlUrl: run.html_url,
  });
}
