import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const guardPolicy = {
  mode: "balanced",
  revision: 1,
  scope: "account_default",
  source: "default",
};
const request = vi.hoisted(() => vi.fn());
const identity = vi.hoisted(() => ({
  svmAddress: "RootWa11et",
  svmCluster: "solana:mainnet" as string | undefined,
}));
vi.mock("@/account/transport", async () => {
  // A real Aomi whose wire is the `request(path, init)` stub: a resolved value
  // is a 200 body; a thrown Error is a failed response carrying its message.
  const { Aomi } = await import("@aomi-labs/client");
  const aomi = new Aomi({
    baseUrl: "",
    fetch: async (input, init) => {
      try {
        return Response.json(await request(String(input), init));
      } catch (cause) {
        return new Response((cause as Error).message, {
          status: 409,
          headers: { "Content-Type": "application/json" },
        });
      }
    },
  });
  const transport = { aomi, settingsThread: () => "thread-a" };
  return {
    useShellTransport: () => transport,
    useShellAomi: () => aomi,
    useAomi: () => aomi,
  };
});
vi.mock("@/wallet/context", () => ({
  useAomiWalletKit: () => ({
    identity,
  }),
}));
import { PolicyPage } from "./policy-page";
import { OnchainRules } from "@/account/rules/onchain-rules";

const profile = {
  user: {},
  auth_providers: [],
  user_accounts: [{ address: { chain: "svm", address: "RootWa11et" } }],
  signing_policies: [
    { address: { chain: "svm", address: "AgentKey" }, mode: "auto" },
  ],
  delegated_accounts: [
    { id: 1, address: { chain: "svm", address: "AgentKey" }, status: "active" },
  ],
  operating_accounts: [],
  onchain_policy_bindings: [],
};

function disabled() {
  return new Error(
    JSON.stringify({ error: "off", error_code: "swig_disabled" }),
  );
}

beforeEach(() => {
  request.mockReset();
  identity.svmCluster = "solana:mainnet";
});

describe("Safety page", () => {
  it("shows only transaction safety; limits live on each agent wallet", async () => {
    request.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/account")) return profile;
      return guardPolicy;
    });
    render(<PolicyPage />);
    expect(
      await screen.findByRole("radiogroup", { name: "Guard policy" }),
    ).toBeTruthy();
    expect(
      request.mock.calls.some(([path]) =>
        String(path).includes("/policies/swig"),
      ),
    ).toBe(false);
  });
});

describe("Agent wallet limits", () => {
  it.each([
    ["solana:mainnet", "solana:mainnet"],
    ["solana:devnet", "solana:devnet"],
    ["solana:testnet", "solana:testnet"],
    ["mainnet-beta", "solana:mainnet"],
    ["devnet", "solana:devnet"],
    ["testnet", "solana:testnet"],
    [undefined, "solana:mainnet"],
  ] as const)(
    "requests the wallet's canonical policy context for %s",
    async (cluster, expected) => {
      identity.svmCluster = cluster;
      request.mockImplementation(async (path: string) => {
        if (path.includes("/policies/swig")) throw disabled();
        if (path.startsWith("/api/account")) return profile;
        return guardPolicy;
      });
      render(<OnchainRules delegate="AgentKey" revision={1} />);
      await waitFor(() =>
        expect(request).toHaveBeenCalledWith(
          `/v1/account/policies/swig?${new URLSearchParams({ chain_ref: expected, delegate: "AgentKey" })}`,
          expect.objectContaining({ method: "GET" }),
        ),
      );
    },
  );

  it("renders nothing when the deployment has Swig off", async () => {
    request.mockImplementation(async (path: string) => {
      if (path.includes("/policies/swig")) throw disabled();
      if (path.startsWith("/api/account")) return profile;
      return guardPolicy;
    });
    const { container } = render(
      <OnchainRules delegate="AgentKey" revision={1} />,
    );
    await waitFor(() =>
      expect(
        request.mock.calls.some(([path]) =>
          String(path).includes("/policies/swig"),
        ),
      ).toBe(true),
    );
    expect(screen.queryByText("Swig on Solana")).toBeNull();
    expect(container.textContent).toBe("");
  });

  const policy = {
    version: 1,
    rules: [
      {
        type: "allowed_call_target",
        target: { chain: "svm", address: "JUP6" },
      },
      {
        type: "recurring_native_asset_limit",
        amount: "500000000",
        window: { unit: "slots", value: 216_000 },
      },
      {
        type: "recurring_token_asset_limit",
        mint: { chain: "svm", address: "EPjF" },
        amount: "100000000",
        window: { unit: "slots", value: 216_000 },
      },
    ],
  };
  const ctx = (extra: object = {}) => ({
    provider: "swig",
    chain_ref: "solana:mainnet",
    targets: { Jupiter: { chain: "svm", address: "JUP6" } },
    mints: {
      wSOL: { chain: "svm", address: "So111" },
      USDC: { chain: "svm", address: "EPjF" },
    },
    slot_windows: [216_000],
    binding: null,
    chain_status: null,
    remaining_native_amount: null,
    remaining_token_amounts: {},
    from_rules: {
      policy,
      missing: null,
      aomi_only: ["Until Nov 21", "Sends only to your wallets"],
      in_sync: false,
    },
    ...extra,
  });
  const serve = (body: object) =>
    request.mockImplementation(async (path: string) => {
      if (path.includes("/policies/swig")) return body;
      if (path.startsWith("/api/account")) return profile;
      return guardPolicy;
    });

  it("offers the wallet's rules for the chain, with nothing to fill in", async () => {
    serve(ctx());
    render(<OnchainRules delegate="AgentKey" revision={1} />);
    expect(await screen.findByText("Swig on Solana")).toBeTruthy();
    expect(screen.getByText("Off")).toBeTruthy();
    const next = screen.getByRole("list", { name: "Goes on chain" });
    expect(next).toHaveTextContent("Can use Jupiter");
    expect(next).toHaveTextContent("Up to 0.5 SOL a day");
    expect(next).toHaveTextContent("Up to 100 USDC a day");
    expect(
      screen.getByText(
        "Aomi alone enforces: Until Nov 21 · Sends only to your wallets",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Enforce on chain" }),
    ).toBeEnabled();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("says what the rules lack when they cannot go on chain", async () => {
    serve(
      ctx({
        from_rules: {
          policy: null,
          missing: "Add a daily SOL limit first. Swig needs one.",
          aomi_only: [],
          in_sync: false,
        },
      }),
    );
    render(<OnchainRules delegate="AgentKey" revision={1} />);
    expect(
      await screen.findByText("Add a daily SOL limit first. Swig needs one."),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Enforce on chain" }),
    ).toBeDisabled();
  });

  it("says when the chain is behind the rules and offers the update", async () => {
    const binding = {
      id: 7,
      policy: { ...policy, rules: policy.rules.slice(0, 2) },
    };
    serve(
      ctx({
        binding,
        chain_status: "current",
        remaining_native_amount: "300000000",
      }),
    );
    render(<OnchainRules delegate="AgentKey" revision={1} />);
    expect(await screen.findByText("Behind your rules")).toBeTruthy();
    expect(
      screen.getByRole("list", { name: "On chain now" }),
    ).not.toHaveTextContent("USDC");
    expect(
      screen.getByRole("list", { name: "After you update" }),
    ).toHaveTextContent("Up to 100 USDC a day");
    expect(screen.getByText("Left on chain: 0.3 SOL")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Update on chain" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Remove from chain" }),
    ).toBeTruthy();
  });

  it("shows On with no update to make when the chain holds the rules", async () => {
    serve(
      ctx({
        binding: { id: 7, policy },
        chain_status: "current",
        from_rules: { policy, missing: null, aomi_only: [], in_sync: true },
      }),
    );
    render(<OnchainRules delegate="AgentKey" revision={1} />);
    expect(await screen.findByText("On")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Update on chain" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Enforce on chain" }),
    ).toBeNull();
  });
});
