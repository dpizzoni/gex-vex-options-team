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
// `jobNames` are the specific CircleCI job names to look for (e.g.
// "gamma-refresh", "gamma-refresh-close"), not workflow names - the
// `daily-close` workflow bundles gamma-refresh-close together with
// fund-flow-refresh, so checking workflow-level status would flag Gamma
// Regime as failed whenever fund-flow-refresh fails on its own.
async function latestCircleCIJobRun(jobNames: string[]) {
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

    for (const workflow of workflows) {
      const jobsRes = await fetch(`https://circleci.com/api/v2/workflow/${workflow.id}/job`, {
        headers,
        cache: "no-store",
      });
      if (!jobsRes.ok) continue;
      const jobs = (await jobsRes.json())?.items ?? [];
      const job = jobs.find((j: { name: string }) => jobNames.includes(j.name));
      if (job) {
        return { ranAt: (job.started_at ?? workflow.created_at) as string, status: job.status as string };
      }
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

  const [
    gexVexCommit,
    gammaCommit,
    fundFlowCommit,
    macroCommit,
    analysisCommit,
    dailyRun,
    intradayRun,
    fundFlowRun,
    gammaCircleCIRun,
    fundFlowCircleCIRun,
    macroCircleCIRun,
    analysisCircleCIRun,
  ] = await Promise.all([
    latestCommitFor(["chore(data): daily UW capture & dealer update"], headers),
    latestCommitFor(
      ["chore(data): daily gamma regime capture", "chore(data): intraday gamma regime refresh"],
      headers
    ),
    latestCommitFor(["chore(data): daily fund-flow & COT capture"], headers),
    latestCommitFor(["chore(data): daily macro liquidity & institutional flow score refresh"], headers),
    latestCommitFor(["chore(data): daily institutional analysis"], headers),
    latestRunConclusion("daily-update.yml", headers),
    latestRunConclusion("gamma-intraday.yml", headers),
    latestRunConclusion("fund-flow-daily.yml", headers),
    latestCircleCIJobRun(["gamma-refresh", "gamma-refresh-close", "gamma-refresh-morning", "gamma-refresh-intraday"]),
    latestCircleCIJobRun(["fund-flow-refresh"]),
    latestCircleCIJobRun(["macro-liquidity-refresh"]),
    latestCircleCIJobRun(["institutional-analysis-refresh"]),
  ]);

  // Gamma Regime and Fund Flow now run on CircleCI (see .circleci/config.yml).
  // Fall back to the old GitHub Actions conclusion only if CIRCLECI_TOKEN
  // isn't configured yet - both GH workflows have their `schedule:` disabled,
  // so their `conclusion` would otherwise stay frozen on a stale run forever.
  const latestGammaRun = [dailyRun, intradayRun]
    .filter((r): r is NonNullable<typeof r> => r != null)
    .sort((a, b) => new Date(b.ranAt).getTime() - new Date(a.ranAt).getTime())[0];
  const gammaFailed = gammaCircleCIRun
    ? gammaCircleCIRun.status === "failed" || gammaCircleCIRun.status === "error"
    : latestGammaRun?.conclusion === "failure" &&
      (!gammaCommit || new Date(latestGammaRun.ranAt).getTime() > new Date(gammaCommit.ranAt).getTime());

  const fundFlowFailed = fundFlowCircleCIRun
    ? fundFlowCircleCIRun.status === "failed" || fundFlowCircleCIRun.status === "error"
    : fundFlowRun?.conclusion === "failure" &&
      (!fundFlowCommit || new Date(fundFlowRun.ranAt).getTime() > new Date(fundFlowCommit.ranAt).getTime());

  // Macro Liquidity/Flow Score and Institutional Analysis run only on
  // CircleCI (macro-liquidity workflow, ~21:30 UTC) - no legacy GitHub
  // Actions run to fall back to, unlike gamma/fund-flow above.
  const macroFailed = macroCircleCIRun
    ? macroCircleCIRun.status === "failed" || macroCircleCIRun.status === "error"
    : false;
  const analysisFailed = analysisCircleCIRun
    ? analysisCircleCIRun.status === "failed" || analysisCircleCIRun.status === "error"
    : false;

  // A failed run only means something if it's newer than the last successful
  // commit - daily-update.yml now has a `concurrency` guard, but a stale
  // failed run (e.g. the duplicate-trigger race that guard fixed) shouldn't
  // keep flashing the warning forever just because it's still the "latest
  // completed run" GitHub reports.
  const gexVexFailed =
    dailyRun?.conclusion === "failure" &&
    (!gexVexCommit || new Date(dailyRun.ranAt).getTime() > new Date(gexVexCommit.ranAt).getTime());

  return NextResponse.json({
    gexVex: {
      ranAt: gexVexCommit?.ranAt ?? null,
      failed: gexVexFailed,
    },
    gammaRegime: {
      ranAt: gammaCommit?.ranAt ?? null,
      failed: gammaFailed,
    },
    fundFlow: {
      ranAt: fundFlowCommit?.ranAt ?? null,
      failed: fundFlowFailed,
    },
    macro: {
      ranAt: macroCommit?.ranAt ?? null,
      failed: macroFailed,
    },
    analysis: {
      ranAt: analysisCommit?.ranAt ?? null,
      failed: analysisFailed,
    },
  });
}
