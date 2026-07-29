import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GITHUB_OWNER = "dpizzoni";
const GITHUB_REPO = "gex-vex-options-team";

// This project is set up in CircleCI via the GitHub App integration, so its
// API v2 project slug is org/project UUIDs, not the legacy "gh/owner/repo"
// form (that returns 404 "Project not found" even with a valid token).
// Found from the project's Pipelines page URL: app.circleci.com/pipelines/circleci/<org-id>/<project-id>
const CIRCLECI_PROJECT_SLUG = "circleci/BWUbnQQnWUZ8GM8D8F8Whf/b453df44-4637-4af1-a6b2-5fcfb28dcf10";

type GhHeaders = Record<string, string>;

async function ghFetch(path: string, headers: GhHeaders) {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}${path}`, {
    headers,
    next: { revalidate: 300 },
  });
  if (!res.ok) return null;
  return res.json();
}

// Gamma Regime moved to CircleCI (see .circleci/config.yml) because GitHub
// Actions ran out of free minutes; its gamma-intraday.yml schedule is
// disabled, so latestRunConclusion for that workflow would stay frozen on
// whatever it last was. This checks CircleCI's own run status instead.
//
// Uses the pipeline/workflow endpoints (not the Insights API) because
// Insights aggregates with a multi-hour lag - right after a fresh run it
// still returns stale/empty data, which silently fell back to the frozen
// GitHub Actions conclusion above.
async function latestCircleCIWorkflowRun(workflowName: string) {
  const token = process.env.CIRCLECI_TOKEN;
  if (!token) return null;
  const headers = { "Circle-Token": token };

  const pipelinesRes = await fetch(
    `https://circleci.com/api/v2/project/${CIRCLECI_PROJECT_SLUG}/pipeline?branch=main`,
    { headers, cache: "no-store" }
  );
  if (!pipelinesRes.ok) return null;
  const pipelines = (await pipelinesRes.json())?.items ?? [];

  for (const pipeline of pipelines) {
    const workflowsRes = await fetch(`https://circleci.com/api/v2/pipeline/${pipeline.id}/workflow`, {
      headers,
      cache: "no-store",
    });
    if (!workflowsRes.ok) continue;
    const workflows = (await workflowsRes.json())?.items ?? [];
    const workflow = workflows.find((w: { name: string }) => w.name === workflowName);
    if (workflow) {
      return { ranAt: workflow.created_at as string, status: workflow.status as string };
    }
  }
  return null;
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

  const [gexVexCommit, gammaCommit, fundFlowCommit, dailyRun, intradayRun, fundFlowRun, gammaCircleCIRun] =
    await Promise.all([
      latestCommitFor(["chore(data): daily UW capture & dealer update"], headers),
      latestCommitFor(
        ["chore(data): daily gamma regime capture", "chore(data): intraday gamma regime refresh"],
        headers
      ),
      latestCommitFor(["chore(data): daily fund-flow & COT capture"], headers),
      latestRunConclusion("daily-update.yml", headers),
      latestRunConclusion("gamma-intraday.yml", headers),
      latestRunConclusion("fund-flow-daily.yml", headers),
      latestCircleCIWorkflowRun("gamma-regime"),
    ]);

  // Gamma Regime now runs on CircleCI (gammaCircleCIRun). Fall back to the
  // old GitHub Actions conclusion only if CIRCLECI_TOKEN isn't configured yet.
  const gammaFailed = gammaCircleCIRun
    ? gammaCircleCIRun.status === "failed" || gammaCircleCIRun.status === "error"
    : [dailyRun, intradayRun]
        .filter((r): r is NonNullable<typeof r> => r != null)
        .sort((a, b) => new Date(b.ranAt).getTime() - new Date(a.ranAt).getTime())[0]?.conclusion === "failure";

  return NextResponse.json({
    gexVex: {
      ranAt: gexVexCommit?.ranAt ?? null,
      failed: dailyRun?.conclusion === "failure",
    },
    gammaRegime: {
      ranAt: gammaCommit?.ranAt ?? null,
      failed: gammaFailed,
    },
    fundFlow: {
      ranAt: fundFlowCommit?.ranAt ?? null,
      failed: fundFlowRun?.conclusion === "failure",
    },
  });
}
