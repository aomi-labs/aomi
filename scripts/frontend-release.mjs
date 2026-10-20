#!/usr/bin/env node
// A reviewed source tree is eligible independently of which surface is published.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const surfaces = {
  portal: {
    project: "prj_JFlrYJshAAVu7U5BxFhLUUpzjegK",
    aliases: ["chat.aomi.dev", "chat-portal-aomi-labs.vercel.app"],
  },
  build: {
    project: "prj_dzx0PWpEPEIbxRjfAzQEiqmNzhRO",
    aliases: ["build.aomi.dev", "aomi-build-aomi-labs.vercel.app"],
  },
  landing: {
    project: "prj_kHH1ejA054BYD3xi831h4BFmxJjO",
    aliases: ["aomi.dev", "landing-page-aomi-labs.vercel.app"],
  },
  telegram: {
    project: "prj_siJXojKKJ3tnqn7ZtLzvImKQGgnQ",
    aliases: ["mini-app.aomi.dev", "tg-mini-app-aomi-labs.vercel.app"],
  },
};
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};
const run = (command, args) =>
  execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
const git = (...args) => run("git", args);
const github = (path) =>
  JSON.parse(run("gh", ["api", `repos/aomi-labs/aomi/${path}`]));

export class Vercel {
  constructor(token) {
    assert(token, "VERCEL_TOKEN required");
    this.token = token;
  }
  async get(path) {
    const response = await fetch(
      `https://api.vercel.com${path}${path.includes("?") ? "&" : "?"}slug=aomi-labs`,
      {
        headers: { Authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(30000),
      },
    );
    assert(response.ok, `Vercel observation failed: HTTP ${response.status}`);
    return response.json();
  }
}

export function validateDeployment(deployment, surface) {
  const config = surfaces[surface];
  assert(config, "Unknown surface");
  assert(
    /^dpl_[A-Za-z0-9]+$/.test(deployment.id),
    "Exact deployment ID required",
  );
  assert(
    deployment.projectId === config.project,
    "Deployment belongs to another surface",
  );
  assert(
    deployment.target === "production" && deployment.readyState === "READY",
    "A READY production build is required; preview promotion would rebuild",
  );
  const sha = deployment.meta?.githubCommitSha;
  assert(/^[0-9a-f]{40}$/.test(sha), "Exact candidate provenance required");
  assert(
    deployment.meta?.githubCommitOrg === "aomi-labs" &&
      deployment.meta?.githubCommitRepo === "aomi",
    "Unexpected source repository",
  );
  return sha;
}

export function validateApproval(pr, deploymentSha, treeEqual, ancestor) {
  assert(
    pr.merged_at &&
      pr.base?.repo?.full_name === "aomi-labs/aomi" &&
      pr.head?.repo?.full_name === "aomi-labs/aomi",
    "Merged first-party approval required",
  );
  assert(
    pr.base.ref === "prod" && pr.head.ref.startsWith("release/"),
    "Source must be approved through release/* -> prod",
  );
  assert(
    [pr.head.sha, pr.merge_commit_sha].includes(deploymentSha),
    "Deployment is not the approved candidate",
  );
  assert(
    ancestor(pr.head.sha, "origin/main"),
    "Candidate must remain reachable from main",
  );
  assert(
    treeEqual(pr.head.sha, deploymentSha),
    "Deployment tree differs from approved candidate",
  );
}

export function validateRuntime(observation, deployment, surface) {
  assert(
    observation.kind === "frontend_runtime" &&
      observation.source_sha === deployment.meta.githubCommitSha &&
      observation.deployment_host === deployment.url,
    "Runtime configuration is not from the exact deployment/source",
  );
  if (surface === "telegram") {
    assert(
      observation.bff_origin === "https://chat.aomi.dev",
      "Telegram BFF target differs",
    );
  } else {
    assert(
      observation.server_api_origin === "https://api.aomi.dev",
      "Deployed BFF targets another API",
    );
    const base = observation.browser_api_base;
    assert(
      base === "/" || base === "/api" || base === "https://api.aomi.dev",
      "Browser API target is missing or differs",
    );
  }
}

export async function observeRuntime(deployment, surface, fetcher = fetch) {
  if (surface === "landing")
    return { api_target_verification: "no_backend_consumer" };
  assert(
    /^[a-z0-9-]+\.vercel\.app$/.test(deployment.url ?? ""),
    "Immutable deployment host required",
  );
  const response = await fetcher(`https://${deployment.url}/api/release`, {
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
    headers: process.env.VERCEL_AUTOMATION_BYPASS_SECRET
      ? {
          "x-vercel-protection-bypass":
            process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
        }
      : {},
  });
  assert(
    response.ok,
    `Exact deployment runtime configuration unavailable (${response.status})`,
  );
  const observation = await response.json();
  validateRuntime(observation, deployment, surface);
  // Telegram calls the canonical Portal BFF. Check that BFF's actual upstream
  // too; the selected Telegram build alone cannot attest to another service.
  if (surface === "telegram") {
    const portal = await fetcher("https://chat.aomi.dev/api/release", {
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });
    assert(portal.ok, "Telegram Portal BFF configuration unavailable");
    const target = await portal.json();
    assert(
      target.kind === "frontend_runtime" &&
        target.server_api_origin === "https://api.aomi.dev",
      "Telegram BFF targets another API",
    );
  }
  return {
    api_target_verification: "exact_deployment_runtime",
    runtime: observation,
  };
}

export async function verifyHeldProjects(api) {
  for (const [surface, config] of Object.entries(surfaces)) {
    const project = await api.get(`/v9/projects/${config.project}`);
    assert(
      project.autoAssignCustomDomains === false,
      `${surface}: automatic production domain assignment must be disabled`,
    );
  }
}

export async function snapshot(api) {
  const result = {};
  for (const [surface, config] of Object.entries(surfaces)) {
    result[surface] = {};
    for (const alias of config.aliases) {
      const current = await api.get(`/v4/aliases/${encodeURIComponent(alias)}`);
      assert(
        current.projectId === config.project && current.deploymentId,
        `Unverified alias ${alias}`,
      );
      result[surface][alias] = current.deploymentId;
    }
  }
  return result;
}

export function verifyRouting(before, after, surface, deploymentId) {
  for (const [name, aliases] of Object.entries(before)) {
    for (const [alias, id] of Object.entries(aliases)) {
      assert(
        after[name]?.[alias] === (name === surface ? deploymentId : id),
        `Alias read-back mismatch: ${alias}`,
      );
    }
  }
}

export async function readRouting(
  api,
  before,
  surface,
  deploymentId,
  {
    attempts = 7,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {},
) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const after = await snapshot(api);
    // Another surface changing is a conflicting operation, never propagation.
    for (const [name, aliases] of Object.entries(before)) {
      if (name === surface) continue;
      for (const [alias, id] of Object.entries(aliases))
        assert(
          after[name]?.[alias] === id,
          `Unrelated alias changed: ${alias}`,
        );
    }
    if (Object.values(after[surface]).every((id) => id === deploymentId))
      return after;
    if (attempt + 1 < attempts) await wait(5000);
  }
  throw Error(
    "Selected aliases did not converge within 30 seconds; retain the pending record and inspect Vercel before retry",
  );
}

export async function releaseSurface({
  surface,
  deploymentId,
  operation,
  api,
  approve,
  contract,
  qa,
  mutate,
  persist = () => {},
  runtime = observeRuntime,
  readback = readRouting,
}) {
  assert(surfaces[surface], "Unknown active surface");
  assert(["promote", "rollback"].includes(operation), "Unknown operation");
  assert(
    /^dpl_[A-Za-z0-9]+$/.test(deploymentId),
    "A deployment ID is required",
  );
  const deployment = await api.get(`/v13/deployments/${deploymentId}`);
  const sha = validateDeployment(deployment, surface);
  await verifyHeldProjects(api);
  await approve(sha);
  const runtimeEvidence = await runtime(deployment, surface);
  await contract(sha);
  const qaEvidence = await qa({ surface, deploymentId, sha });
  const before = await snapshot(api);
  // Check again immediately before mutation; a retry reads actual aliases.
  const current = await api.get(`/v13/deployments/${deploymentId}`);
  assert(
    validateDeployment(current, surface) === sha,
    "Deployment provenance changed",
  );
  persist({
    kind: "frontend_deployment_attempt",
    surface,
    source_sha: sha,
    deployment_id: deploymentId,
    operation,
    aliases_before: before,
    status: "MUTATION_PENDING",
    recorded_at: new Date().toISOString(),
  });
  const alreadyAssigned = Object.values(before[surface]).every(
    (id) => id === deploymentId,
  );
  if (!alreadyAssigned) await mutate(operation, deploymentId);
  await verifyHeldProjects(api);
  const after = await readback(api, before, surface, deploymentId);
  verifyRouting(before, after, surface, deploymentId);
  return {
    kind: "frontend_deployment",
    schema_version: 1,
    surface,
    source_sha: sha,
    deployment_id: deploymentId,
    operation,
    api_target: "https://api.aomi.dev",
    qa: qaEvidence,
    configuration: runtimeEvidence,
    aliases_before: before,
    aliases_after: after,
    routing_already_matches: alreadyAssigned,
    verified_at: new Date().toISOString(),
  };
}

export async function main() {
  const [operation, surface, deploymentId] = process.argv.slice(2);
  assert(
    process.env.GITHUB_REF === "refs/heads/main",
    "Run trusted release tooling from main",
  );
  assert(
    process.env.CONFIRM === (operation === "rollback" ? "ROLLBACK" : "PROMOTE"),
    "Explicit operator authorization required",
  );
  git("fetch", "origin", "main", "prod", "--quiet");
  const api = new Vercel(process.env.VERCEL_TOKEN);
  const evidence = await releaseSurface({
    operation,
    surface,
    deploymentId,
    api,
    approve: (sha) => {
      const prs = github(`commits/${sha}/pulls?per_page=100`);
      const pr = prs.find(
        (pr) =>
          pr.merged_at &&
          pr.base.ref === "prod" &&
          pr.head.ref.startsWith("release/") &&
          [pr.head.sha, pr.merge_commit_sha].includes(sha),
      );
      assert(
        pr,
        "No merged release/* -> prod source approval for this deployment",
      );
      validateApproval(
        pr,
        sha,
        (a, b) =>
          git("rev-parse", `${a}^{tree}`) === git("rev-parse", `${b}^{tree}`),
        (a, b) => {
          try {
            git("merge-base", "--is-ancestor", a, b);
            return true;
          } catch {
            return false;
          }
        },
      );
      // The original policy includes the prod-only hotfix divergence and exact
      // merge-tree checks. Require its GitHub Actions result, never a local flag.
      const checks = github(
        `commits/${pr.head.sha}/check-runs?per_page=100`,
      ).check_runs;
      for (const name of [
        "Production Promotion Policy",
        "Frontend CI Passed",
      ]) {
        const latest = checks
          .filter(
            (row) => row.name === name && row.app?.slug === "github-actions",
          )
          .sort((a, b) => b.id - a.id)[0];
        assert(
          latest?.conclusion === "success" && latest.status === "completed",
          `Missing successful reviewed ${name}`,
        );
      }
    },
    contract: (sha) => {
      // Execute the selected deployment's committed requirements, including on
      // rollback. Current-main requirements are not evidence for an old build.
      const target = `${process.env.RUNNER_TEMP}/frontend-contract-${sha}`;
      git("worktree", "add", "--detach", target, sha);
      try {
        // Trusted checker + candidate manifest/shape fixture. Never execute old
        // checker semantics (the old checker reversed the subset direction).
        const candidateContract = JSON.parse(
          readFileSync(
            `${target}/packages/client/src/test-fixtures/backend-openapi.json`,
            "utf8",
          ),
        );
        writeFileSync(
          `${process.env.RUNNER_TEMP}/consumer-contract.json`,
          JSON.stringify(candidateContract),
        );
        execFileSync("pnpm", ["run", "test:openapi:live"], {
          stdio: "inherit",
          env: {
            ...process.env,
            NEXT_PUBLIC_BACKEND_URL: "https://api.aomi.dev",
            AOMI_CONSUMER_CONTRACT_FILE: `${process.env.RUNNER_TEMP}/consumer-contract.json`,
          },
        });
      } finally {
        git("worktree", "remove", "--force", target);
      }
    },
    qa: async ({ surface, deploymentId, sha }) => {
      const runId = process.env.QA_RUN_ID;
      assert(
        /^[1-9][0-9]*$/.test(runId ?? ""),
        "Exact deployment-bound aomi-qa workflow run required",
      );
      const result = JSON.parse(
        run("gh", ["api", `repos/aomi-labs/aomi-qa/actions/runs/${runId}`]),
      );
      assert(
        result.path === ".github/workflows/frontend.yml" &&
          result.head_branch === "main" &&
          result.event === "workflow_dispatch" &&
          result.status === "completed" &&
          result.conclusion === "success" &&
          result.head_repository?.full_name === "aomi-labs/aomi-qa",
        "Untrusted frontend QA producer",
      );
      const directory = `${process.env.RUNNER_TEMP}/frontend-qa`;
      run("gh", [
        "run",
        "download",
        runId,
        "--repo",
        "aomi-labs/aomi-qa",
        "--name",
        "frontend-qa",
        "--dir",
        directory,
      ]);
      const evidence = JSON.parse(
        readFileSync(`${directory}/frontend-qa.json`, "utf8"),
      );
      assert(
        evidence.surface === surface &&
          evidence.deployment_id === deploymentId &&
          evidence.source_sha === sha &&
          evidence.api_target === "https://api.aomi.dev" &&
          ["exact_deployment_runtime", "no_backend_consumer"].includes(
            evidence.api_target_verification,
          ) &&
          evidence.status === "PASS" &&
          evidence.tests > 0,
        "Frontend QA does not cover this exact deployment and target",
      );
      if (surface !== "landing") {
        assert(
          evidence.authenticated_journeys === "PASS",
          "Authenticated journeys for this exact deployment remain required; public smoke alone is insufficient",
        );
      }
      assert(
        Date.now() - Date.parse(evidence.observed_at) >= 0 &&
          Date.now() - Date.parse(evidence.observed_at) <= 24 * 60 * 60 * 1000,
        "Frontend QA is stale or from the future",
      );
      return { run_id: runId, repository: "aomi-labs/aomi-qa" };
    },
    persist: (record) =>
      writeFileSync(
        "frontend-deployment.json",
        JSON.stringify(record, null, 2) + "\n",
      ),
    mutate: (action, id) =>
      execFileSync("vercel", [action, id, "--scope", "aomi-labs", "--yes"], {
        stdio: "inherit",
        env: process.env,
      }),
  });
  writeFileSync(
    "frontend-deployment.json",
    JSON.stringify(evidence, null, 2) + "\n",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
