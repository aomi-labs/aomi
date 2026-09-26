import { describe, expect, it, vi } from "vitest";
import { AomiClient } from "../src/client";
import { AomiPipeline } from "../src/sdk/pipeline";
import type { Action, ActionRequest } from "../src/agent/types";
import type { CommitView } from "../src/commits";
import type { EvmCommitResult } from "../src/pipeline/types";

const request: ActionRequest = {
  type: "execute_evm",
  commitStages: ["direct:original:0"],
  transactions: [
    {
      chain_id: 1,
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      data: "0x",
      label: "Exact native transfer",
      kind: "transaction",
    },
  ],
};
const action: Action = {
  type: "action",
  event_id: "event",
  sequence: 1,
  turn_id: "turn",
  occurred_at: 1,
  id: "original-action",
  revision: 1,
  state: "pending",
  request,
  created_at: 1,
  expires_at: null,
};
const view: CommitView = {
  version: 1,
  commit_id: "00000000-0000-0000-0000-000000000001",
  thread_id: "standalone-scope",
  stage_id: "direct:original:0",
  chain_family: "evm",
  chain_ref: "1",
  signer: "0x1111111111111111111111111111111111111111",
  broadcaster: "wallet",
  state: "needs_signature",
  action: null,
  transaction_id: null,
  failure_code: null,
  batch: null,
  review: null,
  wallet_attempt: null,
};
const preparation: EvmCommitResult = {
  status: "committed",
  digest: "digest",
  result: {},
  requests: [request],
  actions: [action],
  thread_id: view.thread_id,
  commits: [view],
};

describe("durable public Pipeline continuation", () => {
  it("requests execution authorization for read-only lifecycle refreshes", async () => {
    const observed: string[][] = [];
    const client = new AomiClient({
      baseUrl: "https://api.example",
      guest: false,
      fetch: vi.fn(async () => Response.json(view)),
      oauth: async (request) => {
        observed.push([...request.scopes]);
        return {
          accessToken: "disposable-test-token",
          expiresAt: Date.now() + 60_000,
          resource: request.resource,
          scopes: request.scopes,
        };
      },
    });
    const controller = new AomiPipeline(client.pipeline, client).evm.commits(
      preparation,
    );
    try {
      await controller.refresh(view.commit_id);
      expect(observed).toEqual([["pipeline:execute"]]);
    } finally {
      controller.close();
    }
  });
  it("refreshes and rejects through public Commit routes with the actual scope", async () => {
    const fetch = vi
      .fn()
      .mockImplementation(async (_url, init) =>
        Response.json(
          init.method === "POST"
            ? { ...view, version: 2, state: "rejected" }
            : view,
        ),
      );
    const client = new AomiClient({
      baseUrl: "https://api.example",
      guest: false,
      fetch,
    });
    const pipeline = new AomiPipeline(client.pipeline, client);
    const controller = pipeline.evm.commits(preparation);
    try {
      expect(controller.all()).toEqual([view]);
      await controller.refresh(view.commit_id);
      await controller.reject(view.commit_id);
      expect(fetch.mock.calls.map(([url]) => url)).toEqual([
        `https://api.example/v1/pipeline/evm/commits/${view.commit_id}`,
        `https://api.example/v1/pipeline/evm/commits/${view.commit_id}/manual`,
      ]);
      for (const [, init] of fetch.mock.calls)
        expect(new Headers(init.headers).get("x-thread-id")).toBe(
          view.thread_id,
        );
      expect(JSON.parse(fetch.mock.calls[1]![1].body)).toEqual({
        kind: "rejected",
      });
    } finally {
      controller.close();
    }
  });

  it.each([
    { ...preparation, commits: undefined },
    { ...preparation, requests: [{ ...request, commitStages: [] }] },
    {
      ...preparation,
      commits: [{ ...view, thread_id: "another-owner-scope" }],
    },
    { ...preparation, commits: [{ ...view, stage_id: "another-stage" }] },
    {
      ...preparation,
      actions: [
        { ...action, request: { ...request, commitStages: ["another-stage"] } },
      ],
    },
  ])(
    "fails closed before a wallet or request for an incomplete/mismatched cohort",
    (candidate) => {
      const fetch = vi.fn();
      const client = new AomiClient({
        baseUrl: "https://api.example",
        guest: false,
        fetch,
      });
      expect(() =>
        new AomiPipeline(client.pipeline, client).evm.commits(candidate),
      ).toThrow();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("resolves the complete cohort by immutable stages rather than response array order", () => {
    const refs = ["direct:original:0", "direct:original:1"];
    const ids = [view.commit_id, "00000000-0000-0000-0000-000000000002"];
    const groupRequest: ActionRequest = {
      ...request,
      commitStages: refs,
      transactions: [...request.transactions, ...request.transactions],
    };
    const members = refs.map(
      (stage_id, index): CommitView => ({
        ...view,
        commit_id: ids[index]!,
        stage_id,
        batch: {
          batch_id: "batch",
          index,
          ordered_stage_ids: refs,
          ordered_commit_ids: ids,
          sources: [],
          predecessor_commit_id: index ? ids[0]! : null,
          review_digest: "cohort-review",
        },
      }),
    );
    const client = new AomiClient({
      baseUrl: "https://api.example",
      guest: false,
    });
    const controller = new AomiPipeline(client.pipeline, client).evm.commits({
      ...preparation,
      requests: [groupRequest],
      actions: [{ ...action, request: groupRequest }],
      commits: [...members].reverse(),
    });
    try {
      expect(controller.all().map((member) => member.commit_id)).toEqual(ids);
    } finally {
      controller.close();
    }
  });

  it("keeps raw-only construction compatible but requires an authenticated continuation client", () => {
    const client = new AomiClient({
      baseUrl: "https://api.example",
      guest: false,
    });
    expect(() =>
      new AomiPipeline(client.pipeline).evm.commits(preparation),
    ).toThrow("unavailable");
  });
});
