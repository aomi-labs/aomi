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
      children: ReactNode;
    }) => (
      <div
        data-testid="widget-root"
        data-backend={props.backendUrl}
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
    [{ applicationId: "" }, /applicationId is required/],
    [{ applicationId: "1", baseUrl: "chat.aomi.dev" }, /baseUrl must be/],
    [{ applicationId: "1", theme: "blue" }, /theme must be/],
    [{ applicationId: "1", auth: privyAuth({ appId: " " }) }, /needs appId/],
    [{ applicationId: "1", auth: paraAuth({ apiKey: "" }) }, /needs apiKey/],
    [{ applicationId: "1", auth: { type: "magic" } }, /Unknown auth type/],
  ])("explains invalid props inside the widget: %o", (props, message) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<AomiWidget {...(props as unknown as AomiWidgetProps)} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(message);
    expect(alert.className).toContain("aomi-widget");
  });

  it("accepts a numeric applicationId and the deprecated apiUrl", () => {
    render(<AomiWidget applicationId={42} apiUrl="https://example.test/" />);
    expect(screen.getByTestId("widget-root").dataset.backend).toBe(
      "https://example.test",
    );
    expect(kit.provider.mock.calls[0]![0]).toMatchObject({
      applicationId: "42",
    });
  });

  it("prefers baseUrl over apiUrl", () => {
    render(
      <AomiWidget
        applicationId="1"
        baseUrl="https://base.test"
        apiUrl="https://api.test"
      />,
    );
    expect(screen.getByTestId("widget-root").dataset.backend).toBe(
      "https://base.test",
    );
  });

  it("keeps the host's transform on the widget root", () => {
    render(
      <AomiWidget applicationId="1" style={{ transform: "scale(0.5)" }} />,
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
    render(<AomiWidget applicationId="1" theme={theme} />);
    expect(screen.getByTestId("widget-root").classList).toContain(className);
  });

  it("passes Para's environment, defaulting to PROD", () => {
    render(<AomiWidget applicationId="1" auth={paraAuth({ apiKey: "k" })} />);
    expect(kit.provider.mock.calls[0]![0]).toMatchObject({
      auth: { provider: "para" },
      providers: { para: { apiKey: "k", environment: "PROD" } },
    });
  });
});
