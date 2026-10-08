import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mounted = vi.hoisted(() => ({ config: undefined as unknown }));

// Stub the heavy composer provider so importing the plugin does not pull in
// the full wallet-kit runtime tree.
vi.mock("./privy-delegation", () => ({
  PrivyDelegationProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("./privy-plugin-provider", () => ({
  AomiPrivyPluginProvider: ({ children }: { children: ReactNode }) => children,
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
const { getWalletProvider } = await import("@/wallet/providers/plugin-registry");
const { privyPlugin } = await import("./privy-plugin");
const { setPrivySdk } = await import("./privy-sdk");
setPrivySdk({
  auth: await import("@privy-io/react-auth"),
  smartWallets: await import("@privy-io/react-auth/smart-wallets"),
  solana: {} as never,
});

describe("Privy plugin registration (route-level mount contract)", () => {
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
    await expect(lazy!.load!()).resolves.toBe(privyPlugin);
  });

  it("mounts as a pass-through without an appId instead of rendering blank", () => {
    render(
      <>
        {privyPlugin.wrap?.({
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
        {privyPlugin.wrap?.({
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

  it("is unavailable without an appId and available with one", () => {
    expect(
      privyPlugin.isAvailable?.({
        auth: { provider: "privy" },
        providers: { privy: {} },
      }),
    ).toBe(false);
    expect(
      privyPlugin.isAvailable?.({
        auth: { provider: "privy" },
        providers: { privy: { appId: "host-supplied-app-id" } },
      }),
    ).toBe(true);
  });
});
