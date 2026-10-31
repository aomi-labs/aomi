import { describe, expect, it, vi } from "vitest";

import { Aomi } from "./aomi";
import { isAomiError } from "../api-error";
import type { CommitView } from "../commits";
import type { EvmSimulatedBuild, SvmSimulatedBuild } from "../pipeline/types";

const signer = "0x1111111111111111111111111111111111111111";
const operation = (name: string) => ({
  kind: "operation",
  name,
  description: name,
  method: "POST",
  href: `/v1/pipeline/apps/default/operations/${name}`,
  inputSchema: {
    type: "object",
    required: ["topic", "amount"],
    properties: { topic: { type: "string" }, amount: { type: "string" } },
  },
});
const simulation = {
  status: "passed",
  balanceChanges: [{ asset: "ETH", delta: "-0.1" }],
  approvals: [],
  warnings: [],
  fees: [],
  guards: [],
  gas: null,
  logs: [],
};
const evmBuild = {
  version: 2,
  status: "simulated",
  actions: [
    {
      chain_id: 8453,
      from: signer,
      to: "0x2222222222222222222222222222222222222222",
      data: "0x",
      value: "0",
      label: "Swap",
      kind: "swap",
    },
  ],
  origin: { app: "default", operations: [] },
  simulation,
  expiresAt: 2_000_000_000,
  digest: "sha256:build",
  attestation: "a",
} as unknown as EvmSimulatedBuild;
const view: CommitView = {
  version: 1,
  commit_id: "c-1",
  thread_id: "pipeline:evm:sha256:build",
  stage_id: "direct:a:0",
  chain_family: "evm",
  chain_ref: "8453",
  signer,
  broadcaster: "hosted",
  state: "needs_signature",
  action: null,
  transaction_id: null,
  failure_code: null,
  batch: null,
  review: null,
  wallet_attempt: null,
};
const request = {
  type: "execute_evm",
  commitStages: [view.stage_id],
  transactions: evmBuild.actions,
  simulation,
};

function backend(views: CommitView[] = [view]) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname, body });
    const name = url.pathname.match(/operations\/(.+)$/)?.[1];
    if (name && method === "GET") return Response.json(operation(name));
    if (name) return Response.json({ status: "DONE" });
    if (url.pathname === "/v1/pipeline/apps/default/operations")
      return Response.json({
        kind: "directory",
        path: url.pathname,
        entries: [],
      });
    if (url.pathname === "/v1/pipeline/skills")
      return Response.json({
        kind: "directory",
        path: url.pathname,
        entries: [],
      });
    if (url.pathname === "/v1/pipeline/evm/build")
      return Response.json(evmBuild);
    if (url.pathname === "/v1/pipeline/svm/build")
      return Response.json({
        ...evmBuild,
        actions: [],
      } as unknown as SvmSimulatedBuild);
    if (url.pathname === "/v1/pipeline/evm/commit")
      return Response.json({
        status: "committed",
        digest: evmBuild.digest,
        result: {},
        requests: [request],
        thread_id: view.thread_id,
        actions: [
          {
            type: "action",
            event_id: "e",
            sequence: 1,
            turn_id: "t",
            occurred_at: 1,
            id: "a-1",
            revision: 1,
            state: "pending",
            request,
            created_at: 1,
            expires_at: null,
          },
        ],
        commits: [view],
      });
    if (url.pathname === `/v1/pipeline/evm/commits/${view.commit_id}`)
      return Response.json(views.shift() ?? view);
    return Response.json({ error: "unexpected" }, { status: 500 });
  });
  return {
    calls,
    aomi: new Aomi({ baseUrl: "https://chat.example", guest: false, fetch }),
  };
}

describe("aomi.pipeline without an app", () => {
  it("builds in the default app, fills topic, and commits to one Commit", async () => {
    const { aomi, calls } = backend([
      { ...view, version: 2, state: "submitted" },
      { ...view, version: 3, state: "confirmed" },
    ]);
    const build = await aomi.pipeline.build("stage_lifi_swap", {
      amount: "0.1",
    });

    expect(build.chainFamily).toBe("evm");
    expect(build.balanceChanges).toEqual(simulation.balanceChanges);
    expect(build.digest).toBe("sha256:build");
    expect(
      calls.find((call) => call.path === "/v1/pipeline/evm/build")?.body,
    ).toEqual({
      app: "default",
      operation: "/v1/pipeline/apps/default/operations/stage_lifi_swap",
      arguments: { amount: "0.1", topic: "stage_lifi_swap" },
    });

    const commit = await build.commit();
    expect([commit.ref, commit.kind, commit.state]).toEqual([
      "c-1",
      "evm_tx",
      "needs_signature",
    ]);
    await expect(commit.settled()).resolves.toMatchObject({
      state: "confirmed",
    });
    commit.close();
  });

  it("lists and invokes default-app operations and the skill catalog", async () => {
    const { aomi, calls } = backend();
    await expect(aomi.pipeline.operations()).resolves.toMatchObject({
      kind: "directory",
    });
    await expect(aomi.pipeline.skills.list()).resolves.toMatchObject({
      kind: "directory",
    });
    await aomi.pipeline.invoke("lifi_get_status", { amount: "1" });
    expect(calls.at(-1)).toMatchObject({
      method: "POST",
      path: "/v1/pipeline/apps/default/operations/lifi_get_status",
      body: { amount: "1", topic: "lifi_get_status" },
    });
  });

  it("names the app when forced, and refuses a Solana commit", async () => {
    const { aomi, calls } = backend();
    const build = await aomi.pipeline.build(
      "svm_stage_tx",
      { amount: "1" },
      { app: "jupiter" },
    );
    expect(calls[0]?.path).toBe(
      "/v1/pipeline/apps/jupiter/operations/svm_stage_tx",
    );
    expect(build.chainFamily).toBe("svm");
    await expect(build.commit()).rejects.toSatisfy((error) =>
      isAomiError(error, "svm_commit_unavailable"),
    );
  });
});

describe("Commit settlement", () => {
  const open = async (views: CommitView[]) => {
    const { aomi } = backend(views);
    return (
      await aomi.pipeline.build("stage_lifi_swap", { amount: "0.1" })
    ).commit();
  };

  it("rejects with the failure code and the view when it does not confirm", async () => {
    const commit = await open([
      { ...view, version: 2, state: "failed", failure_code: "reverted" },
    ]);
    const error = await commit.settled().catch((caught: unknown) => caught);
    expect(isAomiError(error, "reverted")).toBe(true);
    expect(error).toMatchObject({ view: { state: "failed" } });
    commit.close();
  });

  it("stops waiting when the signal aborts, before or during", async () => {
    const commit = await open([view, view, view]);
    const before = new AbortController();
    before.abort(new Error("before"));
    await expect(commit.settled({ signal: before.signal })).rejects.toThrow(
      "before",
    );
    const during = new AbortController();
    const waiting = commit.settled({ signal: during.signal });
    during.abort(new Error("during"));
    await expect(waiting).rejects.toThrow("during");
    commit.close();
  });

  it("signs the version it was handed, not one polled since", async () => {
    const changed = {
      ...view,
      version: 2,
      review: { digest: "d2" } as CommitView["review"],
    };
    const commit = await open([changed, changed]);
    // Polling (here, a waiter's) moves the view on; nobody reviewed it.
    const stop = new AbortController();
    const waiting = commit.settled({ signal: stop.signal });
    await vi.waitFor(() => expect(commit.view.version).toBe(2));
    stop.abort();
    await waiting.catch(() => undefined);
    const error = await commit.sign().catch((caught: unknown) => caught);
    expect(isAomiError(error, "commit_stale")).toBe(true);
    commit.close();
  });
});
