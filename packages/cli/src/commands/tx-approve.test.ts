import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AomiClient, type CommitRefView } from "@aomi-labs/client";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn<typeof globalThis.fetch>(),
  close: vi.fn(),
  question: vi.fn<(prompt: string) => Promise<string>>(),
  auth: {
    sessionToken: "session-token",
    expiresAt: Number.MAX_SAFE_INTEGER,
  } as { sessionToken: string; expiresAt: number } | undefined,
}));
vi.mock("../cli-session", () => ({
  CliSession: {
    load: () => ({
      auth: mocks.auth,
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
vi.mock("node:readline/promises", () => {
  const createInterface = () => ({ question: mocks.question, close: () => {} });
  return { createInterface, default: { createInterface } };
});
vi.mock("../errors", () => ({
  fatal: (message: string) => {
    throw new Error(message);
  },
}));

import { txApproveCommand } from "./tx-approve";

const signer = "0x1111111111111111111111111111111111111111";
const parked: CommitRefView = {
  version: 2,
  commit_id: "cmt_park",
  thread_id: "cli-session-1",
  stage_id: "direct:a:0",
  chain_family: "evm",
  chain_ref: "8453",
  signer,
  broadcaster: "wallet",
  state: "awaiting_approval",
  transaction_id: null,
  failure_code: null,
  batch: null,
  wallet_attempt: null,
  action: null,
  approval: { state: "pending", client: "cli", expires_at: 1_760_530_200 },
  can_approve: true,
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
          label: "Buy 10 USDC of ETH",
          kind: "swap",
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
  origin: "cli",
  origin_app: null,
  initiator: "cli",
  notify: "cli",
  sign_url: "https://chat.aomi.dev/sign/cmt_park",
  created_at: 1_760_529_600,
};
const approved: CommitRefView = {
  ...parked,
  version: 3,
  state: "needs_signature",
  can_approve: false,
  approval: { ...parked.approval!, state: "approved", approved_by: "cli" },
};
const confirmed: CommitRefView = {
  ...approved,
  version: 5,
  state: "confirmed",
  transaction_id: "0xabc",
  transaction_url: "https://basescan.org/tx/0xabc",
};
const fast = { intervalMs: 0, timeoutMs: 1000 };

let gets: CommitRefView[];
let approveResponse: () => Response;
const approveBodies: unknown[] = [];

function output(spy: "log" | "error" = "log"): string {
  return vi.mocked(console[spy]).mock.calls.flat().join("\n");
}

function setTty(value: boolean) {
  Object.defineProperty(process.stdin, "isTTY", {
    value,
    configurable: true,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  approveBodies.length = 0;
  mocks.auth = {
    sessionToken: "session-token",
    expiresAt: Number.MAX_SAFE_INTEGER,
  };
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  gets = [parked, approved, confirmed];
  approveResponse = () => Response.json(approved);
  mocks.fetch.mockImplementation(async (input, init) => {
    if (init?.method === "POST" && String(input).endsWith("/approve")) {
      approveBodies.push(JSON.parse(String(init.body)));
      return approveResponse();
    }
    return Response.json(gets.length > 1 ? gets.shift() : gets[0]);
  });
  setTty(true);
});
afterEach(() => setTty(false));

const approveCode = (status: number, code: string) => () =>
  Response.json({ code, status }, { status });

describe("aomi tx approve", () => {
  it("asks, approves at the reviewed version and digest, then prints the explorer URL", async () => {
    mocks.question.mockResolvedValue("y");
    await txApproveCommand({ secrets: {} }, "cmt_park", {}, fast);

    expect(mocks.question).toHaveBeenCalledWith("Approve? [y/N] ");
    expect(String(mocks.fetch.mock.calls[1]?.[0])).toBe(
      "https://example.test/v1/commits/cmt_park/approve",
    );
    expect(approveBodies).toEqual([{ version: 2, review_digest: "digest-2" }]);
    const printed = output();
    expect(printed).toContain("awaiting_approval (version 2)");
    expect(printed).toContain("Buy 10 USDC of ETH");
    expect(printed).toContain("Approved · signing…");
    expect(printed).toContain("Confirmed · https://basescan.org/tx/0xabc");
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("does nothing when the prompt is declined", async () => {
    mocks.question.mockResolvedValue("n");
    await expect(
      txApproveCommand({ secrets: {} }, "cmt_park", {}, fast),
    ).rejects.toThrow("Not approved.");
    expect(approveBodies).toEqual([]);
  });

  it("refuses outside a terminal without --yes", async () => {
    setTty(false);
    await expect(
      txApproveCommand({ secrets: {} }, "cmt_park", {}, fast),
    ).rejects.toThrow("Refusing to approve without --yes outside a terminal.");
    expect(mocks.question).not.toHaveBeenCalled();
    expect(approveBodies).toEqual([]);
  });

  it("approves with --yes and skips following with --no-wait", async () => {
    setTty(false);
    await txApproveCommand(
      { secrets: {} },
      "cmt_park",
      { yes: true, noWait: true },
      fast,
    );
    expect(approveBodies).toEqual([{ version: 2, review_digest: "digest-2" }]);
    expect(output()).toContain(
      "Approved · Aomi is signing. Check with `aomi tx show cmt_park`.",
    );
    expect(output()).not.toContain("Confirmed");
  });

  it("prints the final view as JSON on stdout and the summary on stderr", async () => {
    await txApproveCommand(
      { secrets: {}, json: true },
      "cmt_park",
      { yes: true },
      fast,
    );
    const printed = JSON.parse(
      String(vi.mocked(console.log).mock.calls[0]?.[0]),
    );
    expect(printed).toMatchObject({
      commit_id: "cmt_park",
      state: "confirmed",
      transaction_url: "https://basescan.org/tx/0xabc",
    });
    expect(vi.mocked(console.log)).toHaveBeenCalledOnce();
    expect(output("error")).toContain("awaiting_approval (version 2)");
  });

  it("prints the failure code when the signed commit fails", async () => {
    gets = [
      parked,
      { ...approved, version: 4, state: "failed", failure_code: "reverted" },
    ];
    await txApproveCommand({ secrets: {} }, "cmt_park", { yes: true }, fast);
    expect(output()).toContain("Failed · reverted");
  });

  it.each([
    [
      "forbidden",
      approveCode(403, "commit_approval_forbidden"),
      "Approving needs your Aomi login: run `aomi account login`, or open https://chat.aomi.dev/sign/cmt_park.",
    ],
    [
      "expired",
      approveCode(410, "commit_expired"),
      "Expired · nothing was signed",
    ],
    [
      "stale",
      approveCode(409, "commit_version_conflict"),
      "This commit changed; run `aomi tx show cmt_park`.",
    ],
  ])("maps %s", async (_name, response, message) => {
    approveResponse = response;
    await expect(
      txApproveCommand({ secrets: {} }, "cmt_park", { yes: true }, fast),
    ).rejects.toThrow(message);
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("names the current state when the commit is no longer parked", async () => {
    approveResponse = approveCode(409, "commit_not_awaiting_approval");
    gets = [parked, { ...parked, version: 3, state: "rejected" }];
    await expect(
      txApproveCommand({ secrets: {} }, "cmt_park", { yes: true }, fast),
    ).rejects.toThrow(
      "This commit isn't waiting for approval (state: rejected).",
    );
  });

  it("refuses before asking when the commit is not parked", async () => {
    gets = [{ ...parked, state: "needs_signature", can_approve: false }];
    await expect(
      txApproveCommand({ secrets: {} }, "cmt_park", {}, fast),
    ).rejects.toThrow(
      "This commit isn't waiting for approval (state: needs_signature).",
    );
    expect(mocks.question).not.toHaveBeenCalled();
  });

  it("lets the backend decide: a device login without a session token approves", async () => {
    mocks.auth = undefined;
    await txApproveCommand(
      { secrets: {} },
      "cmt_park",
      { yes: true, noWait: true },
      fast,
    );
    expect(approveBodies).toEqual([{ version: 2, review_digest: "digest-2" }]);
  });

  it("gives the login hint with the sign URL when this login cannot approve", async () => {
    gets = [{ ...parked, can_approve: false }];
    await expect(
      txApproveCommand({ secrets: {} }, "cmt_park", { yes: true }, fast),
    ).rejects.toThrow(
      "Approving needs your Aomi login: run `aomi account login`, or open https://chat.aomi.dev/sign/cmt_park.",
    );
    expect(approveBodies).toEqual([]);
  });

  it("names a missing commit, and passes any other read failure through", async () => {
    mocks.fetch.mockResolvedValue(
      Response.json({ code: "commit_not_found", status: 404 }, { status: 404 }),
    );
    await expect(
      txApproveCommand({ secrets: {} }, "cmt_park", { yes: true }, fast),
    ).rejects.toThrow('Commit "cmt_park" was not found for this account.');
    mocks.fetch.mockResolvedValue(
      Response.json(
        { code: "commit_unauthorized", status: 401 },
        { status: 401 },
      ),
    );
    const failure = await txApproveCommand(
      { secrets: {} },
      "cmt_park",
      { yes: true },
      fast,
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).not.toMatch(/Approving needs/);
  });
});
