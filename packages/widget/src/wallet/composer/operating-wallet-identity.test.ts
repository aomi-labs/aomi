import { describe, expect, it } from "vitest";
import type { AuthRuntime } from "./types";
import { buildWalletKitIdentity } from "./build-identity";
import { resolveWalletState } from "./wallet-state";

const LINKED = "0xb3ec00000000000000000000000000000000ebd0";
const OBSERVED = "0xdc27000000000000000000000000000000000e12";

const auth = {
  provider: "privy",
  status: "authenticated",
  subject: "did:privy:user-1",
  primaryLabel: "Privy user",
  sessionProvider: "privy",
  embeddedProvider: "privy",
  methods: [],
  canOpenModal: true,
} satisfies AuthRuntime;

function identityFor(observedAddress: string) {
  const state = resolveWalletState({
    account: { id: "account-1", status: "ready" },
    linked: [
      {
        id: "linked-1",
        family: "evm",
        address: LINKED,
        kind: "embedded",
        provider: "privy",
      },
    ],
    connections: [
      {
        id: "privy-session",
        family: "evm",
        address: observedAddress,
        kind: "embedded",
        provider: "privy",
        signerReady: true,
      },
    ],
    mountedProviders: ["privy"],
    selection: {},
  });
  return buildWalletKitIdentity({
    auth,
    evmWallet: state.wallets.find(
      (wallet) => wallet.family === "evm" && wallet.operating,
    ),
    isBooting: false,
    isConnected: true,
  });
}

describe("operating wallet identity", () => {
  it("publishes the attested embedded address when the signer matches", () => {
    expect(identityFor(LINKED)).toMatchObject({
      status: "connected",
      isConnected: true,
      address: LINKED,
      walletSource: "embedded",
    });
  });

  it("keeps the account session but publishes no wallet on a signer mismatch", () => {
    expect(identityFor(OBSERVED)).toMatchObject({
      status: "connected",
      isConnected: true,
      address: undefined,
      walletKind: undefined,
      walletSource: undefined,
    });
  });
});
