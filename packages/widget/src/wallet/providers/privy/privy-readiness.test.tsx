import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AomiWalletKitComposerProps } from "@/wallet/composer/types";
import { AomiPrivyPluginProvider } from "./privy-plugin-provider";
import { WalletAuthPublisherContext } from "@/wallet/providers/auth-store";
import { createInitialState } from "@/wallet/registry/reducer";
import type { AomiWalletKit } from "@/wallet/types";
import { resolveWalletState } from "@/wallet/composer/wallet-state";

const EOA = "0x1111111111111111111111111111111111111111";
const SMART = "0x2222222222222222222222222222222222222222";
const EXTERNAL = "0x3333333333333333333333333333333333333333";
const fixture = vi.hoisted(() => ({
  props: null as AomiWalletKitComposerProps | null,
  ready: true,
  authenticated: true,
  hydrated: true,
  external: false,
  detached: false,
  dropped: [] as string[],
  smart: false,
  userEoa: true,
  svmSigning: true,
  identityToken: "signed-identity-token" as string | null,
  accessToken: vi.fn(async () => "signed-access-token"),
  smartSign: vi.fn().mockResolvedValue("0xsmart-signature"),
  smartSend: vi.fn().mockResolvedValue("0xsmart-tx"),
  embeddedSource: vi.fn(),
  providerRequest: vi.fn().mockResolvedValue("0xsignature"),
}));
vi.mock("@aomi-labs/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@aomi-labs/react")>()),
  useUser: () => ({ setUser: publishUser }),
}));
const publishUser = vi.fn();
vi.mock("@/wallet/composer/aomi-wallet-kit-composer", () => ({
  AomiWalletKitComposer: (props: AomiWalletKitComposerProps) => {
    fixture.props = props;
    return props.children;
  },
}));
vi.mock("@/wallet/account/use-resolved-account-runtime", () => ({
  useResolvedAccountRuntime: () => undefined,
}));
vi.mock("@/wallet/network-preferences", () => ({
  useAomiWalletNetworkPreferences: () => ({ supportedSolanaNetworks: [] }),
}));
vi.mock("@/wallet/providers/sources/embedded-session-source", () => ({
  useEmbeddedSessionSource: (...args: unknown[]) =>
    fixture.embeddedSource(...args),
}));
vi.mock("./privy-auth", () => ({
  useSafePrivy: () => ({
    ready: fixture.ready,
    authenticated: fixture.authenticated,
    user: { id: "privy-user" },
    getAccessToken: fixture.accessToken,
  }),
  useSafePrivyIdentityToken: () => fixture.identityToken,
  useSafePrivyModalOpen: () => false,
  useSafeWallets: () => ({ wallets: [], ready: fixture.hydrated }),
  useSafeSmartWallets: () => ({
    client: fixture.smart
      ? {
          account: { address: SMART },
          signTypedData: fixture.smartSign,
          sendTransaction: fixture.smartSend,
        }
      : undefined,
    getClientForChain: async () => undefined,
  }),
  useSafeSvmWallets: () => ({
    ready: true,
    wallets: [
      {
        address: "SolanaWallet",
        signMessage: fixture.svmSigning ? vi.fn() : undefined,
        signTransaction: fixture.svmSigning ? vi.fn() : undefined,
      },
    ],
  }),
  useSafeSignTransaction: () => ({ signTransaction: vi.fn() }),
  pickPrivyEmbeddedEvmWallet: () =>
    fixture.hydrated
      ? {
          address: EOA,
          getEthereumProvider: async () => ({
            request: fixture.providerRequest,
          }),
        }
      : undefined,
  pickPrivyEmbeddedEvmUserWallet: () =>
    fixture.userEoa ? { address: EOA } : undefined,
  inferPrivyAuthMethod: () => "email",
  inferPrivyPrimaryLabel: () => "test@example.com",
  privyLoginMethodsToOptions: () => [],
}));
vi.mock("@/wallet/runtime/evm/wallet-runtime", () => ({
  useEvmWalletRuntime: () => ({
    registryStore: { dispatch: vi.fn() },
    registryState: {
      intents: {
        providerSessionDetached: fixture.detached,
        droppedAddresses: fixture.dropped,
      },
    },
    shouldUseExternalSigner: fixture.external,
    activeEvmConnection: fixture.external ? { address: EXTERNAL } : undefined,
    signTypedDataAsync: fixture.external ? vi.fn() : undefined,
    sendTransactionAsync: fixture.external ? vi.fn() : undefined,
    chainsById: {},
  }),
}));
vi.mock("@/wallet/runtime/svm/wallet-runtime", () => ({
  useSafeSvmWallet: () => ({}),
  useMergedSvmWallet: (_external: unknown, embedded: unknown) => embedded,
  useSvmWalletRuntime: () => ({ execution: {}, identity: () => ({}) }),
}));

beforeEach(() => {
  Object.assign(fixture, {
    props: null,
    ready: true,
    authenticated: true,
    hydrated: true,
    external: false,
    detached: false,
    dropped: [],
    smart: false,
    userEoa: true,
    svmSigning: true,
    identityToken: "signed-identity-token",
  });
  fixture.smartSend.mockReset().mockResolvedValue("0xsmart-tx");
  fixture.smartSign.mockReset().mockResolvedValue("0xsmart-signature");
  fixture.embeddedSource.mockClear();
  fixture.providerRequest.mockClear();
  fixture.accessToken.mockClear();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});
function mount(execution?: import("@/wallet/config/types").ExecutionConfig) {
  render(
    <AomiPrivyPluginProvider supportedChains={[]} execution={execution}>
      wallets
    </AomiPrivyPluginProvider>,
  );
  return fixture.props!.execution;
}

describe("Privy signer readiness", () => {
  it("exchanges the signed identity token when the SDK provides it", async () => {
    mount();
    await expect(fixture.props!.auth.getCredential?.()).resolves.toEqual({
      provider: "privy",
      tokenKind: "identity_token",
      providerToken: "signed-identity-token",
    });
    expect(fixture.accessToken).not.toHaveBeenCalled();
  });
  it("falls back to the access token without an identity token", async () => {
    fixture.identityToken = null;
    mount();
    await expect(fixture.props!.auth.getCredential?.()).resolves.toEqual({
      provider: "privy",
      tokenKind: "access_token",
      providerToken: "signed-access-token",
    });
    expect(fixture.accessToken).toHaveBeenCalledOnce();
  });
  it("makes exact hydrated linked EVM and SVM wallets eligible to operate", () => {
    const execution = mount();
    const linked = [
      {
        id: "evm",
        family: "evm" as const,
        address: EOA,
        kind: "embedded" as const,
        provider: "privy",
      },
      {
        id: "svm",
        family: "svm" as const,
        address: "SolanaWallet",
        kind: "embedded" as const,
        provider: "privy",
      },
    ];
    const state = resolveWalletState({
      account: { id: "account", status: "ready" },
      linked,
      connections: linked.map((wallet) => ({
        ...wallet,
        signerReady: execution.canSignFor?.(wallet.family, wallet.address),
      })),
      mountedProviders: ["privy"],
      selection: {},
    });
    expect(
      state.wallets.map((wallet) => [wallet.state, wallet.operating]),
    ).toEqual([
      ["ready", true],
      ["ready", true],
    ]);
    expect(execution.canSignFor?.("evm", SMART)).toBe(false);
    expect(execution.canSignFor?.("svm", "solanawallet")).toBe(false);
  });
  it.each([
    "booting",
    "signed out",
    "unhydrated",
    "detached",
    "dropped",
    "external active",
  ])("does not claim an embedded EOA signer when %s", (condition) => {
    if (condition === "booting") fixture.ready = false;
    if (condition === "signed out") fixture.authenticated = false;
    if (condition === "unhydrated") fixture.hydrated = false;
    if (condition === "detached") fixture.detached = true;
    if (condition === "dropped") fixture.dropped = [EOA];
    if (condition === "external active") fixture.external = true;
    const execution = mount();
    expect(execution.canSignFor?.("evm", EOA)).toBe(false);
    expect(execution.canSelectFor?.("evm", EOA)).toBe(
      condition === "external active",
    );
  });
  it("reports settled Privy wallet lists independently by family", () => {
    fixture.hydrated = false;
    const execution = mount();
    expect(execution.providerSettled?.("evm", "privy")).toBe(false);
    expect(execution.providerSettled?.("svm", "privy")).toBe(true);
    expect(execution.providerSettled?.("evm", "para")).toBe(false);
  });
  it("waits for Solana signing methods", () => {
    fixture.svmSigning = false;
    expect(mount().canSignFor?.("svm", "SolanaWallet")).toBe(false);
  });
  it("reports only the actual smart fallback address", () => {
    fixture.hydrated = false;
    fixture.smart = true;
    fixture.userEoa = false;
    const execution = mount();
    expect(execution.canSignFor?.("evm", SMART)).toBe(true);
    expect(execution.canSignFor?.("evm", EOA)).toBe(false);
    expect(fixture.embeddedSource).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ up: true, embeddedEvmAddress: SMART }),
    );
  });
  it.each([false, true])(
    "keeps EOA-first identity with a smart wallet (external=%s)",
    (external) => {
      fixture.smart = true;
      fixture.external = external;
      const execution = mount();
      expect(fixture.embeddedSource).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ embeddedEvmAddress: EOA }),
      );
      expect(execution.canSignFor?.("evm", SMART)).toBe(false);
      expect(execution.canSignFor?.("evm", EOA)).toBe(!external);
      expect(execution.canSignFor?.("evm", EXTERNAL)).toBe(external);
      expect(fixture.smartSend).not.toHaveBeenCalled();
      expect(fixture.smartSign).not.toHaveBeenCalled();
    },
  );
  it("honors aa off for smart-wallet readiness and sends", () => {
    fixture.smart = true;
    fixture.hydrated = false;
    fixture.userEoa = false;
    const execution = mount({ aa: "off" });
    expect(execution.canSignFor?.("evm", SMART)).toBe(false);
    expect(execution.evm.sendTransaction).toBeUndefined();
  });
  it("uses the manual smart client for sends and typed data", async () => {
    fixture.smart = true;
    fixture.hydrated = false;
    fixture.userEoa = false;
    const execution = mount();
    await expect(
      execution.evm.sendTransaction!({
        to: EOA,
        value: "0",
        data: "0x",
        chainId: 1,
      }),
    ).resolves.toMatchObject({
      txHash: "0xsmart-tx",
      executionKind: "privy_smart_wallet_4337",
      SmartAccount4337: SMART,
    });
    await expect(
      execution.evm.signTypedData!({
        signer: SMART,
        typed_data: {
          domain: {},
          types: { Test: [{ name: "value", type: "string" }] },
          primaryType: "Test",
          message: { value: "hello" },
        },
      }),
    ).resolves.toEqual({ signature: "0xsmart-signature" });
    expect(fixture.smartSend).toHaveBeenCalledOnce();
    expect(fixture.smartSign).toHaveBeenCalledOnce();
  });
  it("withholds the restored smart methods while an EVM agent operates", async () => {
    fixture.smart = true;
    fixture.hydrated = false;
    fixture.userEoa = false;
    const execution = mount();
    const auth = fixture.props!.auth;
    expect(execution.evm.sendTransaction).toBeTypeOf("function");
    expect(execution.evm.signTypedData).toBeTypeOf("function");
    cleanup();
    const { AomiWalletKitComposer } = await vi.importActual<
      typeof import("@/wallet/composer/aomi-wallet-kit-composer")
    >("@/wallet/composer/aomi-wallet-kit-composer");
    const state = createInitialState();
    state.phase = "stable";
    state.activeByFamily.evm = { family: "evm", address: SMART };
    let kit!: AomiWalletKit;
    render(
      <WalletAuthPublisherContext.Provider
        value={(next) => {
          kit = next;
        }}
      >
        <AomiWalletKitComposer
          auth={auth}
          execution={execution}
          supportedChains={[]}
          evm={{
            ...fixture.props!.evm,
            registryState: state,
            identity: () => ({ address: SMART }),
            accounts: () => [
              {
                id: "smart",
                family: "evm",
                address: SMART,
                walletKind: "embedded",
                provider: "privy",
                active: true,
              },
            ],
            options: [],
          }}
          account={{
            status: "ready",
            user: { id: "smart-agent-guard" },
            linkedAccounts: [],
            refresh: async () => undefined,
            wallets: [
              {
                id: "smart",
                family: "evm",
                address: SMART,
                kind: "embedded",
                provider: "privy",
                linkedVia: "privy",
              },
              {
                id: "agent",
                family: "evm",
                address: EXTERNAL,
                kind: "agent",
                provider: "para",
                linkedVia: "para",
              },
            ],
          }}
        >
          wallets
        </AomiWalletKitComposer>
      </WalletAuthPublisherContext.Provider>,
    );
    expect(kit.identity.address).toBe(SMART);
    expect(kit.sendTransaction).toBe(execution.evm.sendTransaction);
    await act(async () => {
      await kit.activateWallet!(`evm:${EXTERNAL}`);
    });
    expect(kit.identity.address).toBe(EXTERNAL);
    expect(kit.sendTransaction).toBeUndefined();
    expect(kit.signTypedData).toBeUndefined();
    expect(fixture.smartSend).not.toHaveBeenCalled();
    expect(fixture.smartSign).not.toHaveBeenCalled();
  });
  it("preserves the exact embedded typed-data signer check", async () => {
    const execution = mount();
    await expect(
      execution.evm.signTypedData!({ signer: SMART }),
    ).rejects.toThrow("not the requested signer");
    expect(fixture.providerRequest).not.toHaveBeenCalled();
  });
});
