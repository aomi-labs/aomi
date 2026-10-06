import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AomiWalletKitComposerProps } from "../../composer/types";
import { AomiPrivyPluginProvider } from "./PrivyPluginProvider";
import { resolveWalletState } from "../../composer/wallet-state";

const EOA = "0x1111111111111111111111111111111111111111";
const SMART = "0x2222222222222222222222222222222222222222";
const fixture = vi.hoisted(() => ({
  props: null as AomiWalletKitComposerProps | null,
  ready: true,
  authenticated: true,
  hydrated: true,
  external: false,
  detached: false,
  dropped: [] as string[],
  smart: false,
  svmSigning: true,
  identityToken: "signed-identity-token" as string | null,
  accessToken: vi.fn(async () => "signed-access-token"),
  providerRequest: vi.fn().mockResolvedValue("0xsignature"),
}));
vi.mock("../../composer/AomiWalletKitComposer", () => ({
  AomiWalletKitComposer: (props: AomiWalletKitComposerProps) => {
    fixture.props = props;
    return props.children;
  },
}));
vi.mock("../../account/use-resolved-account-runtime", () => ({
  useResolvedAccountRuntime: () => undefined,
}));
vi.mock("../../network-preferences", () => ({
  useAomiWalletNetworkPreferences: () => ({ supportedSolanaNetworks: [] }),
}));
vi.mock("../sources/embedded-session-source", () => ({
  useEmbeddedSessionSource: () => undefined,
}));
vi.mock("./privy-auth", () => ({
  useSafePrivy: () => ({
    ready: fixture.ready,
    authenticated: fixture.authenticated,
    user: { id: "privy-user" },
    getAccessToken: fixture.accessToken,
  }),
  useSafePrivyIdentityToken: () => fixture.identityToken,
  useSafeWallets: () => ({ wallets: [], ready: fixture.hydrated }),
  useSafeSmartWallets: () => ({
    client: fixture.smart
      ? {
          account: { address: SMART },
          signTypedData: vi.fn(),
          sendTransaction: vi.fn(),
        }
      : undefined,
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
  pickPrivyEmbeddedEvmUserWallet: () => ({ address: EOA }),
  inferPrivyAuthMethod: () => "email",
  inferPrivyPrimaryLabel: () => "test@example.com",
  privyLoginMethodsToOptions: () => [],
}));
vi.mock("../../runtime/evm/wallet-runtime", () => ({
  useEvmWalletRuntime: () => ({
    registryStore: { dispatch: vi.fn() },
    registryState: {
      intents: {
        providerSessionDetached: fixture.detached,
        droppedAddresses: fixture.dropped,
      },
    },
    shouldUseExternalSigner: fixture.external,
    activeEvmConnection: fixture.external ? { address: SMART } : undefined,
    signTypedDataAsync: fixture.external ? vi.fn() : undefined,
    chainsById: {},
  }),
}));
vi.mock("../../runtime/svm/wallet-runtime", () => ({
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
    svmSigning: true,
    identityToken: "signed-identity-token",
  });
  fixture.providerRequest.mockClear();
  fixture.accessToken.mockClear();
});
afterEach(cleanup);
function mount() {
  render(
    <AomiPrivyPluginProvider supportedChains={[]}>
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
    const execution = mount();
    expect(execution.canSignFor?.("evm", SMART)).toBe(true);
    expect(execution.canSignFor?.("evm", EOA)).toBe(false);
  });
  it("preserves the exact embedded typed-data signer check", async () => {
    const execution = mount();
    await expect(
      execution.evm.signTypedData!({ signer: SMART }),
    ).rejects.toThrow("not the requested signer");
    expect(fixture.providerRequest).not.toHaveBeenCalled();
  });
});
