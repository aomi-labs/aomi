import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AomiClient,
  AomiCommits,
  commitCapabilities,
  type CommitHandle,
  type CommitRefView,
} from "@aomi-labs/client";
import { CommitSignPanel, commitRelativeTime } from "./commit-sign-panel";

const signer = "0x1111111111111111111111111111111111111111";
const ref = "cmt_panel";
const kit = vi.hoisted(() => ({
  identity: { address: undefined as string | undefined },
  wallets: [] as { key: string; family: string; address: string }[],
  canConnect: true,
  connect: vi.fn(),
  activateWallet: vi.fn(),
  supportedChains: [
    { id: 1, name: "Ethereum", nativeCurrency: { symbol: "ETH" } },
  ],
}));
const signTransaction = vi.hoisted(() => vi.fn(async () => "0xsigned"));

vi.mock("@/wallet/context", () => ({ useAomiWalletKit: () => kit }));
vi.mock("@/wallet/use-action-capabilities", () => ({
  useCommitCapabilities: () =>
    commitCapabilities({
      evm: { address: signer, chainId: () => 1, signTransaction },
    }),
}));

const view = (overrides: Partial<CommitRefView> = {}): CommitRefView => ({
  version: 2,
  commit_id: ref,
  thread_id: "cli-thread",
  stage_id: "direct:a:0",
  chain_family: "evm",
  chain_ref: "1",
  signer,
  broadcaster: "hosted",
  state: "needs_signature",
  transaction_id: null,
  failure_code: null,
  batch: null,
  wallet_attempt: null,
  review: {
    version: 2,
    revision: 1,
    digest: "digest-2",
    request: {
      type: "execute_evm",
      transactions: [
        {
          chain_id: 1,
          from: signer,
          to: "0x2222222222222222222222222222222222222222",
          data: "0x",
          label: "Transfer",
          kind: "transaction",
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
  action: {
    kind: "sign",
    payload: {
      kind: "evm_transaction",
      chain_id: 1,
      signer,
      transaction: {
        to: "0x2222222222222222222222222222222222222222",
        data: "0x",
        value: "0",
        nonce: 0,
        gas: "21000",
        max_fee_per_gas: "1",
        max_priority_fee_per_gas: "1",
      },
    },
  } as CommitRefView["action"],
  origin: "cli",
  origin_app: null,
  initiator: "cli",
  notify: "cli",
  sign_url: `https://portal.example/sign/${ref}`,
  created_at: Math.floor(Date.now() / 1000) - 5 * 60,
  ...overrides,
});

let handle: CommitHandle | undefined;
async function open(initial: CommitRefView, after?: CommitRefView) {
  const writes: { path: string; body: unknown }[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (init?.method === "POST") {
      writes.push({ path, body: JSON.parse(String(init.body)) });
      return Response.json(after ?? initial);
    }
    return Response.json(initial);
  });
  handle = await new AomiCommits(
    new AomiClient({ baseUrl: "https://api.example", guest: false, fetch }),
  ).get(ref);
  return { handle, writes };
}

beforeEach(() => {
  kit.identity.address = signer;
  kit.wallets = [];
  kit.connect.mockReset();
  kit.activateWallet.mockReset();
  signTransaction.mockClear();
});
afterEach(() => {
  handle?.close();
  handle = undefined;
  cleanup();
});

describe("CommitSignPanel", () => {
  it("renders the review with its origin and signs the reviewed version", async () => {
    const { handle, writes } = await open(
      view(),
      view({
        version: 3,
        state: "submitted",
        action: null,
        transaction_id: "0xhash",
      }),
    );
    render(<CommitSignPanel handle={handle} />);

    expect(screen.getByText("From CLI · 5 minutes ago")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Wallet impact" })).toBeTruthy();
    expect(screen.queryByText(/Approve/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Submit/ }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({
      path: `/v1/commits/${ref}/sign`,
      body: { version: 2, review_digest: "digest-2", payloads: ["0xsigned"] },
    });
    expect(await screen.findByText("Submitted; confirming")).toBeTruthy();
  });

  it("asks for exactly the commit's signer before signing", async () => {
    kit.identity.address = "0x9999999999999999999999999999999999999999";
    const { handle } = await open(view());
    render(<CommitSignPanel handle={handle} />);

    expect(screen.getByText(/to review and sign this request/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Submit/ })).toHaveProperty(
      "disabled",
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    await waitFor(() =>
      expect(kit.connect).toHaveBeenCalledWith({ family: "evm" }),
    );
  });

  it("switches to a linked signer instead of connecting a new wallet", async () => {
    kit.identity.address = undefined;
    kit.wallets = [{ key: "evm:signer", family: "evm", address: signer }];
    const { handle } = await open(view());
    render(<CommitSignPanel handle={handle} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Switch to this wallet" }),
    );
    await waitFor(() =>
      expect(kit.activateWallet).toHaveBeenCalledWith("evm:signer"),
    );
    expect(kit.connect).not.toHaveBeenCalled();
  });

  it("shows a settled commit's result with its explorer link", async () => {
    const { handle } = await open(
      view({
        state: "confirmed",
        action: null,
        transaction_id: "0xhash",
        transaction_url: "https://etherscan.io/tx/0xhash",
      }),
    );
    render(<CommitSignPanel handle={handle} />);

    expect(screen.getByText("Confirmed")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /View on explorer/ }),
    ).toHaveProperty("href", "https://etherscan.io/tx/0xhash");
    expect(screen.queryByRole("button", { name: /Submit/ })).toBeNull();
  });
});

describe("commitRelativeTime", () => {
  it("reads unix seconds", () => {
    const now = Date.parse("2026-10-15T12:00:00Z");
    expect(commitRelativeTime(now / 1000 - 7200, now)).toBe("2 hours ago");
    expect(commitRelativeTime(now / 1000 - 30, now)).toBe("just now");
    expect(commitRelativeTime(now / 1000 - 86_400, now)).toBe("yesterday");
    expect(commitRelativeTime(undefined, now)).toBeUndefined();
  });
});
