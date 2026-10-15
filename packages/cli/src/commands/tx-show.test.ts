import { beforeEach, describe, expect, it, vi } from "vitest";
import { AomiClient, type CommitRefView } from "@aomi-labs/client";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn<typeof globalThis.fetch>(),
  close: vi.fn(),
}));
vi.mock("../cli-session", () => ({
  CliSession: {
    load: () => ({
      mergeConfig: () => {},
      createClientSession: () => ({
        close: mocks.close,
        client: new AomiClient({
          baseUrl: "https://example.test",
          guest: false,
          fetch: mocks.fetch,
        }),
      }),
    }),
  },
}));
vi.mock("../errors", () => ({
  fatal: (message: string) => {
    throw new Error(message);
  },
}));

import { txShowCommand } from "./tx-show";

const signer = "0x1111111111111111111111111111111111111111";
const view: CommitRefView = {
  version: 2,
  commit_id: "cmt_show",
  thread_id: "mcp-session-1",
  stage_id: "direct:a:0",
  chain_family: "evm",
  chain_ref: "8453",
  signer,
  broadcaster: "wallet",
  state: "needs_signature",
  transaction_id: null,
  failure_code: null,
  batch: null,
  wallet_attempt: null,
  action: null,
  review: {
    version: 2,
    revision: 1,
    digest: "digest-2",
    request: {
      type: "execute_evm",
      transactions: [
        {
          chain_id: 8453,
          from: signer,
          to: "0x2222222222222222222222222222222222222222",
          data: "0x",
          label: "Supply 100 USDC to Aave",
          kind: "supply",
        },
      ],
      simulation: {
        status: "passed",
        balanceChanges: [],
        approvals: [],
        warnings: [],
        fees: [],
        guards: [],
        gas: null,
        logs: [],
      },
    },
    legs: [],
  },
  origin: "mcp",
  origin_app: null,
  initiator: "mcp:client-1",
  notify: "mcp:client-1",
  sign_url: "https://chat.aomi.dev/sign/cmt_show",
  created_at: 1_760_529_600,
};

describe("aomi tx show", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("prints state, chain, signer, origin, review summary and sign URL", async () => {
    mocks.fetch.mockResolvedValue(Response.json(view));
    await txShowCommand({ secrets: {} }, "cmt_show");

    expect(String(mocks.fetch.mock.calls[0]?.[0])).toBe(
      "https://example.test/v1/commits/cmt_show",
    );
    const output = vi.mocked(console.log).mock.calls.flat().join("\n");
    for (const expected of [
      "needs_signature (version 2)",
      "evm:8453",
      signer,
      "mcp · initiated by mcp:client-1",
      "1 EVM transaction: Supply 100 USDC to Aave · simulation passed",
      "https://chat.aomi.dev/sign/cmt_show",
    ])
      expect(output).toContain(expected);
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("prints JSON with the review summary", async () => {
    mocks.fetch.mockResolvedValue(Response.json(view));
    await txShowCommand({ secrets: {}, json: true }, "cmt_show");
    const printed = JSON.parse(
      String(vi.mocked(console.log).mock.calls[0]?.[0]),
    );
    expect(printed).toMatchObject({
      commit_id: "cmt_show",
      sign_url: view.sign_url,
      review_summary:
        "1 EVM transaction: Supply 100 USDC to Aave · simulation passed",
    });
  });

  it("reports a missing or foreign ref plainly", async () => {
    mocks.fetch.mockResolvedValue(
      Response.json({ code: "commit_not_found", status: 404 }, { status: 404 }),
    );
    await expect(txShowCommand({ secrets: {} }, "cmt_other")).rejects.toThrow(
      'Commit "cmt_other" was not found for this account.',
    );
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});
