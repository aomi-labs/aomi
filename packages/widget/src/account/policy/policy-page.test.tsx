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
import { OnchainPolicySettings } from "./onchain-policy-settings";

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
      render(<OnchainPolicySettings delegate="AgentKey" />);
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
    const { container } = render(<OnchainPolicySettings delegate="AgentKey" />);
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

  it("shows the curated apps and token caps for that wallet when enabled", async () => {
    request.mockImplementation(async (path: string) => {
      if (path.includes("/policies/swig"))
        return {
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
        };
      if (path.startsWith("/api/account")) return profile;
      return guardPolicy;
    });
    render(<OnchainPolicySettings delegate="AgentKey" />);
    expect(await screen.findByText("Swig on Solana")).toBeTruthy();
    expect(screen.getByText("Jupiter")).toBeTruthy();
    expect(screen.getByLabelText("Cap wSOL")).toBeTruthy();
    expect(screen.getByLabelText("Cap USDC")).toBeTruthy();
    // The wallet is the delegate: there is no agent to pick.
    expect(screen.queryByText("Delegated agent")).toBeNull();
    expect(screen.getByText("Agent wallet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Activate Swig" })).toBeTruthy();
  });
});
