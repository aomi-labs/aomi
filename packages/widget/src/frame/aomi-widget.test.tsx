import type { CSSProperties, ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const kit = vi.hoisted(() => ({
  provider: vi.fn(),
}));

vi.mock("./aomi-frame", () => ({
  AomiFrame: {
    Root: (props: {
      className?: string;
      style?: CSSProperties;
      backendUrl: string;
      agentTarget?: unknown;
      children: ReactNode;
    }) => (
      <div
        data-testid="widget-root"
        data-backend={props.backendUrl}
        data-target={JSON.stringify(props.agentTarget ?? null)}
        className={props.className}
        style={props.style}
      >
        {props.children}
      </div>
    ),
    Composer: () => null,
  },
}));
vi.mock("./widget-shell", () => ({ WidgetShell: () => null }));
vi.mock("@/wallet/svm-wallet-binding-gate", () => ({
  SvmWalletBindingGate: () => null,
}));
vi.mock("@/account/transport", () => ({
  ShellTransportProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/wallet/config/aomi-wallet-kit-provider", () => ({
  AomiWalletKitProvider: (props: { children: ReactNode }) => {
    kit.provider(props);
    return props.children;
  },
}));
vi.mock("@/wallet/context", () => ({
  useAomiWalletKit: () => ({ identity: {} }),
}));

import {
  AomiWidget,
  paraAuth,
  privyAuth,
  type AomiWidgetProps,
} from "./aomi-widget";

afterEach(() => {
  cleanup();
  kit.provider.mockClear();
});

describe("AomiWidget props", () => {
  it.each([
    [{ agent: "default" }, /agent must look like/],
    [{ agent: "a/b/c" }, /agent must look like/],
    [{ agent: "acme/assistant", baseUrl: "aomi.chat" }, /baseUrl must be/],
    [{ agent: "acme/assistant", theme: "blue" }, /theme must be/],
    [
      { agent: "acme/assistant", auth: privyAuth({ appId: " " }) },
      /needs appId/,
    ],
    [
      { agent: "acme/assistant", auth: paraAuth({ apiKey: "" }) },
      /needs apiKey/,
    ],
    [{ agent: "acme/assistant", auth: { type: "magic" } }, /Unknown auth type/],
  ])("explains invalid props inside the widget: %o", (props, message) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<AomiWidget {...(props as unknown as AomiWidgetProps)} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(message);
    expect(alert.className).toContain("aomi-widget");
  });

  it("accepts a baseUrl and defaults to the main agent", () => {
    render(<AomiWidget baseUrl="https://example.test/" />);
    expect(screen.getByTestId("widget-root").dataset.backend).toBe(
      "https://example.test",
    );
    expect(kit.provider.mock.calls[0]![0]).toMatchObject({
      agent: "aomi/main",
    });
    expect(screen.getByTestId("widget-root").dataset.target).toBe(
      JSON.stringify({ mode: "direct", agent: "aomi/main" }),
    );
  });

  it("creates every thread for the configured agent", () => {
    render(<AomiWidget agent="acme/assistant" />);
    expect(screen.getByTestId("widget-root").dataset.target).toBe(
      JSON.stringify({ mode: "direct", agent: "acme/assistant" }),
    );
  });

  it("keeps the host's transform on the widget root", () => {
    render(
      <AomiWidget agent="acme/assistant" style={{ transform: "scale(0.5)" }} />,
    );
    expect(screen.getByTestId("widget-root").style.transform).toBe(
      "scale(0.5) translateZ(0)",
    );
  });

  it.each([
    ["light", "light"],
    ["dark", "dark"],
    ["system", "light"],
  ] as const)("applies theme=%s as the %s class", (theme, className) => {
    render(<AomiWidget agent="acme/assistant" theme={theme} />);
    expect(screen.getByTestId("widget-root").classList).toContain(className);
  });

  it("passes Para's environment, defaulting to PROD", () => {
    render(
      <AomiWidget agent="acme/assistant" auth={paraAuth({ apiKey: "k" })} />,
    );
    expect(kit.provider.mock.calls[0]![0]).toMatchObject({
      auth: { provider: "para" },
      providers: { para: { apiKey: "k", environment: "PROD" } },
    });
  });
});
