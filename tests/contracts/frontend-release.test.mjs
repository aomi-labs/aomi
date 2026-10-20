import { test } from "node:test";
import assert from "node:assert/strict";
import {
  surfaces,
  releaseSurface,
  verifyRouting,
  validateApproval,
  validateRuntime,
  readRouting,
  observeRuntime,
} from "../../scripts/frontend-release.mjs";

function fixture(surface) {
  const sha = "a".repeat(40),
    id = "dpl_new";
  const state = Object.fromEntries(
    Object.entries(surfaces).flatMap(([s, c]) =>
      c.aliases.map((alias) => [
        alias,
        { deploymentId: `dpl_${s}`, projectId: c.project },
      ]),
    ),
  );
  const calls = [];
  const deployment = {
    id,
    projectId: surfaces[surface].project,
    target: "production",
    readyState: "READY",
    meta: {
      githubCommitSha: sha,
      githubCommitOrg: "aomi-labs",
      githubCommitRepo: "aomi",
    },
  };
  return {
    state,
    calls,
    deployment,
    options: {
      surface,
      deploymentId: id,
      operation: "promote",
      api: {
        get: async (path) => {
          if (path.startsWith("/v13")) return deployment;
          if (path.startsWith("/v9")) return { autoAssignCustomDomains: false };
          return structuredClone(
            state[decodeURIComponent(path.split("/").at(-1))],
          );
        },
      },
      approve: () => {},
      contract: () => {},
      runtime: () => ({ api_target_verification: "exact_deployment_runtime" }),
      qa: () => ({ status: "PASS" }),
      mutate: (operation, id) => {
        calls.push([operation, id]);
        for (const alias of surfaces[surface].aliases)
          state[alias].deploymentId = id;
      },
    },
  };
}
for (const surface of Object.keys(surfaces)) {
  test(`${surface} promotion changes exactly one surface`, async () => {
    const { options, calls } = fixture(surface);
    const result = await releaseSurface(options);
    assert.equal(calls.length, 1);
    verifyRouting(
      result.aliases_before,
      result.aliases_after,
      surface,
      "dpl_new",
    );
  });
  test(`${surface} rollback requires only that surface target`, async () => {
    const { options, calls } = fixture(surface);
    await releaseSurface({ ...options, operation: "rollback" });
    assert.deepEqual(calls, [["rollback", "dpl_new"]]);
  });
}
test("API failure prevents any mutation", async () => {
  const { options, calls } = fixture("portal");
  await assert.rejects(
    releaseSurface({
      ...options,
      contract: () => {
        throw Error("missing API");
      },
    }),
  );
  assert.equal(calls.length, 0);
});
test("QA mismatch prevents any mutation", async () => {
  const { options, calls } = fixture("portal");
  await assert.rejects(
    releaseSurface({
      ...options,
      qa: () => {
        throw Error("wrong candidate");
      },
    }),
  );
  assert.equal(calls.length, 0);
});
test("wrong project and preview rebuild fail closed", async () => {
  for (const property of ["projectId", "target", "readyState"]) {
    const { options, deployment, calls } = fixture("portal");
    deployment[property] = "wrong";
    await assert.rejects(releaseSurface(options));
    assert.equal(calls.length, 0);
  }
});
test("alias mismatch or unexpected unrelated change is failure", async () => {
  const { options, state } = fixture("landing");
  await assert.rejects(
    releaseSurface({
      ...options,
      mutate: () => {
        state["chat.aomi.dev"].deploymentId = "dpl_rogue";
      },
    }),
  );
});
test("source approval cannot be replaced with main ancestry alone", () => {
  const sha = "a".repeat(40),
    pr = {
      merged_at: "now",
      base: { ref: "prod", repo: { full_name: "aomi-labs/aomi" } },
      head: {
        ref: "release/2026-10-20",
        sha,
        repo: { full_name: "aomi-labs/aomi" },
      },
      merge_commit_sha: "b".repeat(40),
    };
  validateApproval(
    pr,
    sha,
    () => true,
    () => true,
  );
  assert.throws(() =>
    validateApproval(
      { ...pr, merged_at: null },
      sha,
      () => true,
      () => true,
    ),
  );
  assert.throws(() =>
    validateApproval(
      pr,
      sha,
      () => false,
      () => true,
    ),
  );
  assert.throws(() =>
    validateApproval(
      pr,
      sha,
      () => true,
      () => false,
    ),
  );
  assert.throws(() =>
    validateApproval(
      pr,
      "c".repeat(40),
      () => true,
      () => true,
    ),
  );
});

test("automatic assignment on any surface blocks a merge/release", async () => {
  const { verifyHeldProjects } =
    await import("../../scripts/frontend-release.mjs");
  await verifyHeldProjects({
    get: async () => ({ autoAssignCustomDomains: false }),
  });
  await assert.rejects(
    verifyHeldProjects({
      get: async (path) => ({
        autoAssignCustomDomains: path.includes(surfaces.build.project),
      }),
    }),
  );
});
test("a pending mutation record survives provider interruption", async () => {
  const { options } = fixture("portal"),
    records = [];
  await assert.rejects(
    releaseSurface({
      ...options,
      persist: (record) => records.push(record),
      mutate: () => {
        throw Error("interrupted");
      },
    }),
  );
  assert.equal(records[0].status, "MUTATION_PENDING");
  assert.equal(records[0].surface, "portal");
  assert.ok(records[0].aliases_before.portal);
});

test("runtime proof binds actual upstream and compiled browser configuration to deployment", () => {
  const deployment = {
    url: "candidate.vercel.app",
    meta: { githubCommitSha: "a".repeat(40) },
  };
  const observation = {
    kind: "frontend_runtime",
    source_sha: "a".repeat(40),
    deployment_host: deployment.url,
    server_api_origin: "https://api.aomi.dev",
    browser_api_base: "/",
  };
  validateRuntime(observation, deployment, "portal");
  for (const [key, value] of [
    ["source_sha", "b".repeat(40)],
    ["deployment_host", "alias.vercel.app"],
    ["server_api_origin", "https://api-staging.aomi.dev"],
    ["browser_api_base", "http://127.0.0.1:8080"],
  ])
    assert.throws(() =>
      validateRuntime({ ...observation, [key]: value }, deployment, "portal"),
    );
  assert.throws(() =>
    validateRuntime(
      { ...observation, bff_origin: "https://other.example" },
      deployment,
      "telegram",
    ),
  );
});
test("unavailable runtime proof prevents mutation", async () => {
  const { options, calls } = fixture("portal");
  await assert.rejects(
    releaseSurface({
      ...options,
      runtime: () => {
        throw Error("unobserved configuration");
      },
    }),
  );
  assert.equal(calls.length, 0);
});

test("provider interruption followed by retry observes aliases and avoids a second mutation", async () => {
  const { options, calls } = fixture("portal");
  const mutate = options.mutate;
  await assert.rejects(
    releaseSurface({
      ...options,
      mutate: (...args) => {
        mutate(...args);
        throw Error("connection lost after provider accepted");
      },
    }),
  );
  const result = await releaseSurface(options);
  assert.equal(calls.length, 1);
  assert.equal(result.routing_already_matches, true);
});
test("alias propagation is bounded and unrelated drift is immediately fatal", async () => {
  const { options, state } = fixture("portal");
  const before = Object.fromEntries(
    Object.entries(surfaces).map(([surface, config]) => [
      surface,
      Object.fromEntries(
        config.aliases.map((alias) => [alias, state[alias].deploymentId]),
      ),
    ]),
  );
  let waits = 0;
  const after = await readRouting(options.api, before, "portal", "dpl_new", {
    attempts: 3,
    wait: async () => {
      waits++;
      options.mutate("promote", "dpl_new");
    },
  });
  assert.equal(waits, 1);
  verifyRouting(before, after, "portal", "dpl_new");
  state[surfaces.build.aliases[0]].deploymentId = "dpl_conflict";
  await assert.rejects(
    readRouting(options.api, before, "portal", "dpl_new", {
      wait: async () => {
        throw Error("should not wait");
      },
    }),
    /Unrelated alias/,
  );
});

test("Landing live demos require exact configuration proof too", () => {
  const deployment = {
    url: "landing.vercel.app",
    meta: { githubCommitSha: "a".repeat(40) },
  };
  assert.throws(() => validateRuntime({}, deployment, "landing"));
  validateRuntime(
    {
      kind: "frontend_runtime",
      source_sha: deployment.meta.githubCommitSha,
      deployment_host: deployment.url,
      server_api_origin: "https://api.aomi.dev",
      browser_api_base: "/",
    },
    deployment,
    "landing",
  );
});

test("Landing release executes the immutable deployment configuration observation", async () => {
  const deployment = {
    url: "landing.vercel.app",
    meta: { githubCommitSha: "a".repeat(40) },
  };
  let requests = 0;
  const evidence = await observeRuntime(deployment, "landing", async (url) => {
    requests++;
    assert.equal(url, "https://landing.vercel.app/api/release");
    return {
      ok: true,
      json: async () => ({
        kind: "frontend_runtime",
        source_sha: deployment.meta.githubCommitSha,
        deployment_host: deployment.url,
        server_api_origin: "https://api.aomi.dev",
        browser_api_base: "/",
      }),
    };
  });
  assert.equal(requests, 1);
  assert.equal(evidence.api_target_verification, "exact_deployment_runtime");
  await assert.rejects(
    observeRuntime(deployment, "landing", async () => ({
      ok: false,
      status: 404,
    })),
    /unavailable/,
  );
});

test("QA authorization requires exact trusted attempt and complete authenticated stories", async () => {
  const { validateQa } = await import("../../scripts/frontend-release.mjs");
  const now = Date.parse("2026-10-20T12:00:00Z");
  const run = {
    id: 123,
    run_attempt: 2,
    path: ".github/workflows/frontend-authenticated.yml",
    head_branch: "main",
    event: "workflow_dispatch",
    status: "completed",
    conclusion: "success",
    head_repository: { full_name: "aomi-labs/aomi-qa" },
    run_started_at: "2026-10-20T11:55:00Z",
    updated_at: "2026-10-20T11:59:00Z",
  };
  const evidence = {
    kind: "frontend_authenticated_qa",
    schema_version: 1,
    surface: "portal",
    deployment_id: "dpl_exact",
    source_sha: "a".repeat(40),
    api_target: "https://api.aomi.dev",
    api_target_verification: "exact_deployment_runtime",
    status: "PASS",
    authenticated_journeys: "PASS",
    github_run_id: "123",
    github_run_attempt: "2",
    observed_at: "2026-10-20T11:58:00Z",
    stories: [
      "authenticated_identity",
      "session_persists_after_reload",
      "oauth_login_logout",
      "wallet_sign_reject_disconnect",
      "streaming_chat_recovery",
    ].map((story) => ({ story, verdict: "PASS" })),
  };
  const context = {
    surface: "portal",
    deploymentId: "dpl_exact",
    sha: "a".repeat(40),
    authenticated: true,
    now,
  };
  assert.equal(validateQa(run, evidence, context).run_attempt, 2);
  for (const patch of [
    { github_run_attempt: "1" },
    { github_run_id: "999" },
    { source_sha: "b".repeat(40) },
    { deployment_id: "dpl_other" },
    { api_target: "https://api-staging.aomi.dev" },
    { observed_at: "2026-10-20T11:54:00Z" },
    { observed_at: "2026-10-20T12:01:00Z" },
    { observed_at: "2026-10-18T11:58:00Z" },
    { stories: [] },
    { stories: evidence.stories.slice(0, 2) },
    { authenticated_journeys: "BLOCKED" },
    { stories: [...evidence.stories, evidence.stories[0]] },
    {
      stories: [
        ...evidence.stories,
        { story: "additional_safety", verdict: "BLOCKED" },
      ],
    },
  ])
    assert.throws(() => validateQa(run, { ...evidence, ...patch }, context));
  for (const patch of [
    { run_attempt: 1 },
    { conclusion: "failure" },
    { status: "in_progress" },
    { head_branch: "unreviewed" },
    { path: ".github/workflows/frontend.yml" },
    { head_repository: { full_name: "fork/aomi-qa" } },
  ])
    assert.throws(() => validateQa({ ...run, ...patch }, evidence, context));
});

test("Landing public smoke remains independently authorized and cannot stand in for authenticated QA", async () => {
  const { validateQa } = await import("../../scripts/frontend-release.mjs");
  const run = {
    id: 123,
    run_attempt: 1,
    path: ".github/workflows/frontend.yml",
    head_branch: "main",
    event: "workflow_dispatch",
    status: "completed",
    conclusion: "success",
    head_repository: { full_name: "aomi-labs/aomi-qa" },
    run_started_at: "2026-10-20T11:55:00Z",
    updated_at: "2026-10-20T11:59:00Z",
  };
  const evidence = {
    kind: "frontend_browser_qa",
    schema_version: 1,
    surface: "landing",
    deployment_id: "dpl_exact",
    source_sha: "a".repeat(40),
    api_target: "https://api.aomi.dev",
    api_target_verification: "exact_deployment_runtime",
    status: "PASS",
    github_run_id: "123",
    github_run_attempt: "1",
    observed_at: "2026-10-20T11:58:00Z",
    scope: "public_surface_smoke",
    tests: 3,
    mutations_blocked: true,
    authenticated_journeys: "NOT_RUN",
  };
  const context = {
    surface: "landing",
    deploymentId: "dpl_exact",
    sha: "a".repeat(40),
    now: Date.parse("2026-10-20T12:00:00Z"),
  };
  assert.equal(validateQa(run, evidence, context).run_id, "123");
  assert.throws(() =>
    validateQa(run, evidence, { ...context, authenticated: true }),
  );
  assert.throws(() => validateQa(run, { ...evidence, tests: 0 }, context));
});

test("new pending or failed GitHub checks supersede older favorable checks", async () => {
  const { validateChecks } = await import("../../scripts/frontend-release.mjs");
  const checks = ["Production Promotion Policy", "Frontend CI Passed"].map(
    (name, id) => ({
      id,
      name,
      app: { slug: "github-actions" },
      status: "completed",
      conclusion: "success",
    }),
  );
  validateChecks(checks);
  for (const status of ["queued", "in_progress", "completed"]) {
    assert.throws(() =>
      validateChecks([
        ...checks,
        { ...checks[0], id: 100, status, conclusion: "failure" },
      ]),
    );
  }
  assert.throws(() =>
    validateChecks(
      checks.map((row) => ({ ...row, app: { slug: "third-party" } })),
    ),
  );
});

test("source approval is rechecked before routing and new failure prevents mutation", async () => {
  const { options, calls } = fixture("portal");
  let approvals = 0;
  await assert.rejects(
    releaseSurface({
      ...options,
      approve: () => {
        if (++approvals === 2) throw Error("new failed CI");
      },
    }),
    /new failed CI/,
  );
  assert.equal(calls.length, 0);
});
