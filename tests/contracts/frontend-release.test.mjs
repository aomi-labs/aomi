import { test } from "node:test";
import assert from "node:assert/strict";
import {
  surfaces,
  releaseSurface,
  verifyRouting,
  validateApproval,
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
