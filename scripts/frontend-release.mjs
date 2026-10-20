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

// Paths whose changes alter authentication, wallet signing, payment or the
// BFF/server boundary. Only these require dedicated-account browser journeys.
export const SENSITIVE =
  /^(?:apps\/[^/]+\/src\/(?:server|middleware|proxy)|apps\/[^/]+\/src\/app\/(?:api|oauth)|packages\/(?:account|client)\/src|packages\/widget\/src\/(?:wallet|account)|packages\/deploy\/src\/bff)(?:\/|\.|$)|(?:^|[/._-])(?:auth|oauth|wallet|payment|x402|session|privy|signing)(?:[/._-]|$)/;

/** Which QA a routing change needs, decided by surface, operation and risk. */
export function qaRequirement({ surface, operation, changed }) {
  if (surface === "landing")
    return { authenticated: false, reason: "Landing has no authenticated surface" };
  if (operation === "rollback")
    return {
      authenticated: false,
      reason: "Rollback restores a previously served deployment; public smoke re-verifies it",
    };
  if (changed === null)
    return {
      authenticated: true,
      sensitive: ["(unknown: the live deployment's source could not be compared)"],
    };
  const sensitive = changed.filter((path) => SENSITIVE.test(path));
  if (sensitive.length === 0)
    return {
      authenticated: false,
      reason: "No auth, wallet, payment or BFF path changed since the live deployment",
    };
  return { authenticated: true, sensitive };
}

export function validateQa(
  run,
  evidence,
  { surface, deploymentId, sha, authenticated = false, now = Date.now() },
) {
  const workflow = authenticated
    ? "frontend-authenticated.yml"
    : "frontend.yml";
  assert(
    run.path === `.github/workflows/${workflow}` &&
      run.head_branch === "main" &&
      run.event === "workflow_dispatch" &&
      run.status === "completed" &&
      run.conclusion === "success" &&
      run.head_repository?.full_name === "aomi-labs/aomi-qa" &&
      Number.isSafeInteger(run.id) &&
      Number.isSafeInteger(run.run_attempt) &&
      run.run_attempt > 0,
    "Untrusted frontend QA producer",
  );
  const observed = Date.parse(evidence.observed_at);
  assert(
    evidence.kind ===
      (authenticated ? "frontend_authenticated_qa" : "frontend_browser_qa") &&
      evidence.schema_version === 1 &&
      evidence.surface === surface &&
      evidence.deployment_id === deploymentId &&
      evidence.source_sha === sha &&
      evidence.api_target === "https://api.aomi.dev" &&
      evidence.api_target_verification === "exact_deployment_runtime" &&
      evidence.status === "PASS" &&
      String(evidence.github_run_id) === String(run.id) &&
      String(evidence.github_run_attempt) === String(run.run_attempt) &&
      observed >= Date.parse(run.run_started_at) &&
      observed <= Date.parse(run.updated_at) &&
      now >= observed &&
      now - observed <= 24 * 60 * 60 * 1000,
    "Frontend QA does not cover this exact deployment, attempt and target, or is stale",
  );
  if (authenticated) {
    const required = {
      portal: [
        "authenticated_identity",
        "session_persists_after_reload",
        "oauth_login_logout",
        "wallet_sign_reject_disconnect",
        "streaming_chat_recovery",
      ],
      build: [
        "authenticated_identity",
        "session_persists_after_reload",
        "github_oauth_install_wizard",
        "project_observability_and_bot_identity",
      ],
    }[surface];
    const stories = evidence.stories;
    assert(
      required &&
        evidence.authenticated_journeys === "PASS" &&
        Array.isArray(stories) &&
        stories.length > 0 &&
        new Set(stories.map((row) => row.story)).size === stories.length &&
        stories.every((row) => row.verdict === "PASS") &&
        required.every((name) => stories.some((row) => row.story === name)),
      "Complete authenticated journeys remain required; partial or public smoke cannot authorize routing",
    );
  } else {
    assert(
      evidence.scope === "public_surface_smoke" &&
        Number.isSafeInteger(evidence.tests) &&
        evidence.tests > 0 &&
        evidence.mutations_blocked === true,
      "Public browser smoke incomplete",
    );
  }
  return {
    run_id: String(run.id),
    run_attempt: run.run_attempt,
    repository: "aomi-labs/aomi-qa",
  };
}

export function validateChecks(checks) {
  for (const name of ["Production Promotion Policy", "Frontend CI Passed"]) {
    const latest = checks
      .filter((row) => row.name === name && row.app?.slug === "github-actions")
      .sort((a, b) => b.id - a.id)[0];
    assert(
      latest?.conclusion === "success" && latest.status === "completed",
      `Missing successful reviewed ${name}`,
    );
  }
}

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
        redirect: "error",
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
  const live = Object.values((await snapshot(api))[surface])[0];
  const liveSha =
    live === deploymentId
      ? sha
      : (await api.get(`/v13/deployments/${live}`)).meta?.githubCommitSha;
  const qaEvidence = await qa({ surface, deploymentId, sha, operation, liveSha });
  const before = await snapshot(api);
  // Check again immediately before mutation; a retry reads actual aliases.
  const current = await api.get(`/v13/deployments/${deploymentId}`);
  assert(
    validateDeployment(current, surface) === sha,
    "Deployment provenance changed",
  );
  assert(
    current.url === deployment.url,
    "Immutable deployment hostname changed",
  );
  await approve(sha);
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
      const checks = [];
      for (let page = 1; page <= 100; page++) {
        const body = github(
          `commits/${pr.head.sha}/check-runs?per_page=100&page=${page}`,
        );
        checks.push(...body.check_runs);
        if (checks.length >= body.total_count) break;
        assert(page < 100, "Review check inventory truncated");
      }
      validateChecks(checks);
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
    qa: async ({ surface, deploymentId, sha, operation, liveSha }) => {
      // The newest successful producer run for this exact deployment, unless
      // the operator names one. The evidence is verified either way.
      const resolve = (workflow, explicit) => {
        if (explicit) return explicit;
        const title = `${workflow === "frontend.yml" ? "Frontend QA" : "Frontend authenticated QA"} ${surface} ${deploymentId}`;
        const runs = JSON.parse(
          run("gh", [
            "api",
            `repos/aomi-labs/aomi-qa/actions/workflows/${workflow}/runs?event=workflow_dispatch&branch=main&status=success&per_page=100`,
          ]),
        ).workflow_runs.filter((row) => row.display_title === title);
        assert(runs.length > 0, `No successful aomi-qa "${title}" run; dispatch aomi-qa ${workflow} for this deployment`);
        return String(Math.max(...runs.map((row) => row.id)));
      };
      const read = (runId, authenticated) => {
        assert(
          /^[1-9][0-9]*$/.test(runId ?? ""),
          "Exact deployment-bound QA run required",
        );
        const result = JSON.parse(
          run("gh", ["api", `repos/aomi-labs/aomi-qa/actions/runs/${runId}`]),
        );
        const directory = `${process.env.RUNNER_TEMP}/frontend-qa-${runId}-${result.run_attempt}`;
        run("gh", [
          "run",
          "download",
          runId,
          "--repo",
          "aomi-labs/aomi-qa",
          "--name",
          authenticated
            ? `frontend-authenticated-qa-${result.run_attempt}`
            : `frontend-qa-${result.run_attempt}`,
          "--dir",
          directory,
        ]);
        const evidence = JSON.parse(
          readFileSync(
            `${directory}/${authenticated ? "frontend-authenticated-qa" : "frontend-qa"}.json`,
            "utf8",
          ),
        );
        const proof = validateQa(result, evidence, {
          surface,
          deploymentId,
          sha,
          authenticated,
        });
        const current = JSON.parse(
          run("gh", ["api", `repos/aomi-labs/aomi-qa/actions/runs/${runId}`]),
        );
        assert(
          String(result.id) === runId &&
            current.id === result.id &&
            current.run_attempt === result.run_attempt &&
            current.status === "completed" &&
            current.conclusion === "success" &&
            current.head_sha === result.head_sha,
          "QA producer changed during evidence verification",
        );
        return proof;
      };
      const publicEvidence = read(resolve("frontend.yml", process.env.QA_RUN_ID), false);
      let changed = null;
      try {
        changed = git("diff", "--name-only", liveSha, sha).split("\n").filter(Boolean);
      } catch {
        changed = null; // Unknown history fails closed below.
      }
      const need = qaRequirement({ surface, operation, changed });
      if (!need.authenticated)
        return {
          public: publicEvidence,
          authenticated: { status: "NOT_REQUIRED", reason: need.reason },
        };
      assert(
        surface === "portal" || surface === "build",
        `${surface}: security-sensitive change (${need.sensitive.join(", ")}) needs authenticated browser QA, and aomi-qa has no authenticated ${surface} producer yet`,
      );
      return {
        public: publicEvidence,
        authenticated: read(
          resolve("frontend-authenticated.yml", process.env.AUTHENTICATED_QA_RUN_ID),
          true,
        ),
        sensitive: need.sensitive,
      };
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
