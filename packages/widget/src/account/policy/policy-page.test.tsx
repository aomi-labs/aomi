import { render, screen } from "@testing-library/react";
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
