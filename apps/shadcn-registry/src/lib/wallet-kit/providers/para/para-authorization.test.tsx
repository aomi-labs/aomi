import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { privateKeyToAccount } from "viem/accounts";
import type { AomiWalletKitComposerProps } from "../../composer/types";
import { AomiParaPluginProvider } from "./ParaPluginProvider";

const state = vi.hoisted(() => ({
  props: null as AomiWalletKitComposerProps | null,
  connected: true,
  detached: false,
  wallets: {} as Record<string, { id: string; address: string; type: string }>,
  signMessage: vi.fn(),
  registryStore: { dispatch: vi.fn() },
}));
vi.mock("../../composer/AomiWalletKitComposer", () => ({
  AomiWalletKitComposer: (props: AomiWalletKitComposerProps) => {
    state.props = props;
    return props.children;
  },
}));
vi.mock("../../account/use-resolved-account-runtime", () => ({
  useResolvedAccountRuntime: () => undefined,
}));
vi.mock("../../network-preferences", () => ({
  useAomiWalletNetworkPreferences: () => ({ supportedSolanaNetworks: [] }),
}));
vi.mock("./sources/para-session-source", () => ({
  useParaSessionSource: () => undefined,
}));
vi.mock("./para-auth", () => ({
  useSafeParaAccount: () => ({
    isConnected: state.connected,
    isLoading: false,
    embedded: { wallets: Object.values(state.wallets) },
  }),
  useSafeParaClient: () => ({
    wallets: state.wallets,
    signMessage: state.signMessage,
  }),
  useSafeLogout: () => undefined,
  useSafeParaModal: () => undefined,
  createParaCredentialGetter: () => undefined,
  resolveParaSubject: () => "test-user",
  resolveParaAuthValue: () => undefined,
  defaultOAuthMethods: [],
}));
vi.mock("../../runtime/evm/wallet-runtime", () => ({
  useEvmWalletRuntime: () => ({
    registryStore: state.registryStore,
    registryState: {
      connections: [{ stableId: "para" }],
      intents: {
        providerSessionDetached: state.detached,
        droppedAddresses: [],
      },
    },
    // Deliberately no active connector: availability comes from exact SDK wallets.
    chainsById: {},
    supportedChains: [],
    identity: () => ({}),
  }),
}));
vi.mock("../../runtime/svm/wallet-runtime", () => ({
  DEFAULT_SVM_ENDPOINT: "http://localhost:8899",
  useSafeSvmWallet: () => ({ connected: false }),
  useSvmWalletRuntime: () => ({
    identity: () => ({}),
    execution: {},
    supportedNetworks: [],
  }),
}));

describe("Para authorization wiring", () => {
  const first = privateKeyToAccount(`0x${"11".repeat(32)}`);
  const second = privateKeyToAccount(`0x${"22".repeat(32)}`);
  beforeEach(() => {
    state.connected = true;
    state.detached = false;
    state.wallets = {
      first: { id: "first", address: first.address, type: "EVM" },
      second: { id: "second", address: second.address, type: "EVM" },
      sol: { id: "sol", address: "SolanaWallet", type: "SOLANA" },
    };
    state.signMessage.mockReset();
    state.signMessage.mockImplementation(
      async ({ walletId, messageBase64 }) => ({
        signature:
          walletId === "sol"
            ? Buffer.alloc(64, 1).toString("base64")
            : await (walletId === "first" ? first : second).sign({
                hash: `0x${Buffer.from(messageBase64, "base64").toString("hex")}`,
              }),
      }),
    );
  });

  it("exposes and targets both EVM wallets and Solana without an extension", async () => {
    render(<AomiParaPluginProvider>settings</AomiParaPluginProvider>);
    const { execution, svm } = state.props!;
    for (const wallet of Object.values(state.wallets)) {
      const family = wallet.type === "EVM" ? "evm" : "svm";
      expect(execution.canSignFor?.(family, wallet.address)).toBe(true);
      if (family === "evm") {
        await execution.evm.signTypedData?.({
          signer: wallet.address,
          typed_data: {
            domain: { name: "Permit", version: "1" },
            types: { Permit: [{ name: "wallet", type: "string" }] },
            primaryType: "Permit",
            message: { wallet: wallet.address },
          },
        });
      } else {
        await svm?.execution.signSolanaMessage?.({
          signer: wallet.address,
          message: "cGVybWl0",
        });
      }
      expect(state.signMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({ walletId: wallet.id }),
      );
    }
    expect(
      execution.canSignFor?.(
        "evm",
        "0x3333333333333333333333333333333333333333",
      ),
    ).toBe(false);
  });

  it.each(["signed out", "disconnected"])(
    "does not expose cached SDK wallets after %s",
    async (condition) => {
      state.connected = condition !== "signed out";
      state.detached = condition === "disconnected";
      render(<AomiParaPluginProvider>settings</AomiParaPluginProvider>);
      expect(state.props!.execution.canSignFor?.("evm", first.address)).toBe(
        false,
      );
      expect(state.props!.execution.canSignFor?.("svm", "SolanaWallet")).toBe(
        false,
      );
      await expect(
        state.props!.svm!.execution.signSolanaMessage!({
          signer: "SolanaWallet",
          message: "cGVybWl0",
        }),
      ).rejects.toThrow("No Solana wallet");
      expect(state.signMessage).not.toHaveBeenCalled();
    },
  );
});
