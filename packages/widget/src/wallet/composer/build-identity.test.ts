import { expect, it } from "vitest";
import { buildWalletKitIdentity } from "./build-identity";

it("gives an agent Solana pick a network without a local Solana identity", () => {
  const params = {
    auth: { status: "authenticated", provider: "para" },
    svmWallet: { address: "AgentSolanaAddress", family: "svm", kind: "agent" },
    isBooting: false,
    isConnected: true,
  } as Parameters<typeof buildWalletKitIdentity>[0];
  expect(buildWalletKitIdentity(params)).toMatchObject({
    svmAddress: "AgentSolanaAddress",
    svmCluster: "solana:mainnet",
    walletSource: "agent",
  });
  expect(
    buildWalletKitIdentity({
      ...params,
      svm: {
        identity: () => ({}),
        selectedNetwork: { cluster: "solana:devnet" },
      } as never,
    }).svmCluster,
  ).toBe("solana:devnet");
});
