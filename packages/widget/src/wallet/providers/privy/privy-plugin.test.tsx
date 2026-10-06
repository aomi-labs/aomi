import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mounted = vi.hoisted(() => ({ config: undefined as unknown }));

// Stub the heavy composer provider so importing the plugin does not pull in
// the full wallet-kit runtime tree.
vi.mock("./PrivyPluginProvider", () => ({
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

// Imported after the mocks are registered. The import itself is the fixture
// contract under test: a host that pulls the providers/privy entrypoint must
// end up with a resolvable "privy" plugin (the widget-consumer ?provider=privy
// route went blank when this side effect was missing).
const { privyPlugin } = await import("./privy-plugin");
const { getWalletProvider, requireWalletProvider } =
  await import("../plugin-registry");

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

  it("registers itself on import so auth={provider:'privy'} can resolve the plugin", () => {
    expect(getWalletProvider("privy")).toBe(privyPlugin);
    expect(() => requireWalletProvider("privy")).not.toThrow();
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
