import { NextResponse } from "next/server";

const GITHUB_OWNER = "dpizzoni";
const GITHUB_REPO = "gex-vex-options-team";

type GhHeaders = Record<string, string>;

async function ghFetch(path: string, headers: GhHeaders) {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}${path}`, {
    headers,
    next: { revalidate: 300 },
  });
  if (!res.ok) return null;
  return res.json();
}

// Most recent completed run's conclusion for a workflow file. Used only for
// the failure flag - the "as of" timestamp itself comes from git commits (see
// latestCommitFor below), since a workflow can finish with conclusion=failure
// on one stage while still having committed fresh data for the other
// (daily-update.yml commits gamma and OI as two separate always() steps).
async function latestRunConclusion(workflowFile: string, headers: GhHeaders) {
  const body = await ghFetch(`/actions/workflows/${workflowFile}/runs?status=completed&per_page=1`, headers);
  const run = body?.workflow_runs?.[0];
  return run ? { ranAt: run.run_started_at as string, conclusion: run.conclusion as string | null } : null;
}

// Most recent commit whose message starts with one of the given prefixes -
// this is the real "data as of" signal for what's actually sitting in cache/
// right now, independent of whether the run that produced it was ultimately
// marked failed elsewhere in the job.
async function latestCommitFor(prefixes: string[], headers: GhHeaders) {
  const commits = await ghFetch(`/commits?sha=main&per_page=100`, headers);
  if (!Array.isArray(commits)) return null;
  for (const c of commits) {
    const msg: string = c.commit?.message ?? "";
    if (prefixes.some((p) => msg.startsWith(p))) {
      return { ranAt: c.commit.author.date as string, sha: c.sha as string };
    }
  }
  return null;
}

export async function GET() {
  const token = process.env.GH_DISPATCH_TOKEN;
  const headers: GhHeaders = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const [gexVexCommit, gammaCommit, dailyRun, intradayRun] = await Promise.all([
    latestCommitFor(["chore(data): daily UW capture & dealer update"], headers),
    latestCommitFor(
      ["chore(data): daily gamma regime capture", "chore(data): intraday gamma regime refresh"],
      headers
    ),
    latestRunConclusion("daily-update.yml", headers),
    latestRunConclusion("gamma-intraday.yml", headers),
  ]);

  // Gamma Regime is refreshed by either workflow (daily-update.yml once,
  // gamma-intraday.yml twice more); whichever completed run is more recent
  // is the one whose conclusion actually reflects the current gamma data.
  const latestGammaRun = [dailyRun, intradayRun]
    .filter((r): r is NonNullable<typeof r> => r != null)
    .sort((a, b) => new Date(b.ranAt).getTime() - new Date(a.ranAt).getTime())[0] ?? null;

  return NextResponse.json({
    gexVex: {
      ranAt: gexVexCommit?.ranAt ?? null,
      failed: dailyRun?.conclusion === "failure",
    },
    gammaRegime: {
      ranAt: gammaCommit?.ranAt ?? null,
      failed: latestGammaRun?.conclusion === "failure",
    },
  });
}
