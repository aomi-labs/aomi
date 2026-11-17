import type { Chain } from "viem";
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mounted = vi.hoisted(() => ({ config: undefined as unknown }));

// Stub the heavy composer provider so importing the adapter does not pull in
// the full wallet-kit runtime tree.
vi.mock("./privy-adapter-provider", () => ({
  AomiPrivyAdapterProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@privy-io/react-auth", () => ({
  PrivyProvider: ({
    children,
    config,
  }: {
    children: ReactNode;
    config: unknown;
  }) => {
    mounted.config = config;
    return <div data-testid="privy-provider">{children}</div>;
  },
}));

vi.mock("@privy-io/react-auth/smart-wallets", () => ({
  SmartWalletsProvider: ({ children }: { children: ReactNode }) => children,
}));

// Imported after the mocks are registered.
const { getWalletProvider } =
  await import("@/wallet/providers/provider-registry");
const { privyAdapter } = await import("./privy-adapter");
const { setPrivySdk } = await import("./privy-sdk");
setPrivySdk({
  auth: await import("@privy-io/react-auth"),
  smartWallets: await import("@privy-io/react-auth/smart-wallets"),
  solana: {} as never,
});

describe("Privy adapter registration (route-level mount contract)", () => {
  const envKey = "NEXT_PUBLIC_PRIVY_APP_ID";
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env[envKey];
    delete process.env[envKey];
  });

  afterEach(() => {
    cleanup();
    if (savedEnv === undefined) delete process.env[envKey];
    else process.env[envKey] = savedEnv;
  });

  it("resolves auth={provider:'privy'} without a provider import, loading the SDK on demand", async () => {
    const lazy = getWalletProvider("privy");
    expect(lazy?.load).toBeTypeOf("function");
    await expect(lazy!.load!()).resolves.toBe(privyAdapter);
  });

  it("mounts as a pass-through without an appId instead of rendering blank", () => {
    render(
      <>
        {privyAdapter.wrap?.({
          auth: { provider: "privy" },
          providers: { privy: {} },
          children: <div>widget-body</div>,
        })}
      </>,
    );
    expect(screen.getByText("widget-body")).toBeTruthy();
    expect(screen.queryByTestId("privy-provider")).toBeNull();
  });

  it("mounts PrivyProvider when the host passes providers.privy.appId", () => {
    render(
      <>
        {privyAdapter.wrap?.({
          auth: { provider: "privy" },
          providers: { privy: { appId: "host-supplied-app-id" } },
          children: <div>widget-body</div>,
        })}
      </>,
    );
    expect(screen.getByTestId("privy-provider")).toBeTruthy();
    expect(mounted.config).toMatchObject({
      externalWallets: { walletConnect: { enabled: false } },
    });
    expect(screen.getByText("widget-body")).toBeTruthy();
  });

  it("lets the embedded wallet switch to the host's chains (Robinhood Chain)", () => {
    const robinhood = { id: 4663, name: "Robinhood Chain" } as Chain;
    render(
      <>
        {privyAdapter.wrap?.({
          auth: { provider: "privy" },
          providers: { privy: { appId: "host-supplied-app-id" } },
          supportedChains: [robinhood],
          children: <div>widget-body</div>,
        })}
      </>,
    );
    expect(mounted.config).toMatchObject({ supportedChains: [robinhood] });
  });

  it("is unavailable without an appId and available with one", () => {
    expect(
      privyAdapter.isAvailable?.({
        auth: { provider: "privy" },
        providers: { privy: {} },
      }),
    ).toBe(false);
    expect(
      privyAdapter.isAvailable?.({
        auth: { provider: "privy" },
        providers: { privy: { appId: "host-supplied-app-id" } },
      }),
    ).toBe(true);
  });
});
