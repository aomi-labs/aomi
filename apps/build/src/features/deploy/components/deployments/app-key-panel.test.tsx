import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const buildFetch = vi.fn();
vi.mock("@/lib/session-expiry", () => ({
  buildFetch: (...args: unknown[]) => buildFetch(...args),
}));
const toast = vi.fn();
vi.mock("@/components/control-plane/toast", () => ({
  useToast: () => ({ toast }),
}));

import { AppKeyPanel, maskAppKey } from "./app-key-panel";

const KEY = `aomi-${"a".repeat(64)}`;
const NEXT_KEY = `aomi-${"b".repeat(64)}`;
const appKey = (key: string) => ({
  key,
  keyPrefix: key.slice(0, 8),
  applicationId: 42,
  createdAt: 1,
  lastUsedAt: null,
});
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200 });

afterEach(() => {
  buildFetch.mockReset();
  toast.mockReset();
});

describe("AppKeyPanel", () => {
  it("masks the key until revealed", async () => {
    buildFetch.mockResolvedValueOnce(json({ appKey: appKey(KEY) }));
    render(<AppKeyPanel applicationId={42} appName="my-app" />);

    const value = await screen.findByTestId("app-key-value");
    expect(value.textContent).toBe(maskAppKey(KEY, KEY.slice(0, 8)));
    expect(value.textContent).not.toContain("aaaaaaaaaa");
    expect(buildFetch).toHaveBeenCalledWith(
      "/api/build/deployments/app-key?applicationId=42",
      { cache: "no-store" },
    );

    fireEvent.click(screen.getByRole("button", { name: "Reveal app key" }));
    expect(screen.getByTestId("app-key-value").textContent).toBe(KEY);
  });

  it("regenerates only after confirming, then shows the new key", async () => {
    buildFetch
      .mockResolvedValueOnce(json({ appKey: appKey(KEY) }))
      .mockResolvedValueOnce(json({ appKey: appKey(NEXT_KEY) }));
    render(<AppKeyPanel applicationId={42} appName="my-app" />);

    fireEvent.click(await screen.findByRole("button", { name: /Regenerate/ }));
    expect(buildFetch).toHaveBeenCalledTimes(1);
    fireEvent.click(
      screen
        .getAllByRole("button", { name: "Regenerate" })
        .find((button) => button.closest("[role=dialog]"))!,
    );

    await waitFor(() =>
      expect(screen.getByTestId("app-key-value").textContent).toBe(NEXT_KEY),
    );
    expect(buildFetch).toHaveBeenLastCalledWith(
      "/api/build/deployments/app-key",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ applicationId: 42 }),
      }),
    );
  });

  it("offers to generate the first key", async () => {
    buildFetch
      .mockResolvedValueOnce(json({ appKey: null }))
      .mockResolvedValueOnce(json({ appKey: appKey(KEY) }));
    render(<AppKeyPanel applicationId={42} appName="my-app" />);

    fireEvent.click(
      await screen.findByRole("button", { name: /Generate key/ }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("app-key-value").textContent).toBe(KEY),
    );
  });
});
