import { cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("NEXT_PUBLIC_GA_MEASUREMENT_ID", "G-TEST");
vi.mock("@/hooks/use-cookie-consent", () => ({
  useCookieConsent: () => ({ consent: "accepted" }),
}));
vi.mock("next/script", () => ({
  default: (props: { src?: string; id?: string }) => (
    <span data-testid="ga-script" data-src={props.src} id={props.id} />
  ),
}));
vi.mock("@aomi-labs/widget/host-composition", () => ({ Button: "button" }));
const { GoogleAnalytics } = await import("./analytics");

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("Google Analytics credential exclusion", () => {
  it("renders nothing during SSR", () => {
    expect(renderToString(<GoogleAnalytics />)).toBe("");
  });
  it.each([
    "/link/telegram?code=secret",
    "/?return_to=%2Flink%2Ftelegram%3Fcode%3Dsecret",
  ])("never loads scripts on %s with consent", (url) => {
    window.history.replaceState(null, "", url);
    render(<GoogleAnalytics />);
    expect(screen.queryByTestId("ga-script")).toBeNull();
  });
  it("loads scripts on ordinary pages with consent", () => {
    window.history.replaceState(null, "", "/settings");
    render(<GoogleAnalytics />);
    expect(screen.getAllByTestId("ga-script")).toHaveLength(2);
  });
});
