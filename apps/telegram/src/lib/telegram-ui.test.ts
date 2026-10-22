import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useTelegramMainButton } from "./telegram-ui";

function installWebApp(overrides: Record<string, unknown> = {}) {
  const button = {
    setText: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    showProgress: vi.fn(),
    hideProgress: vi.fn(),
    onClick: vi.fn(),
    offClick: vi.fn(),
  };
  (window as unknown as { Telegram?: unknown }).Telegram = {
    WebApp: { MainButton: button, ...overrides },
  };
  return button;
}

afterEach(() => {
  delete (window as unknown as { Telegram?: unknown }).Telegram;
});

describe("useTelegramMainButton", () => {
  it("declines ownership when there is no Telegram button", () => {
    // The fallback that matters: outside Telegram, a page whose only action
    // lived on the native button would have no action at all.
    const { result } = renderHook(() =>
      useTelegramMainButton({ label: "Sign", onClick: vi.fn() }),
    );
    expect(result.current).toBe(false);
  });

  it("takes ownership and shows the action", () => {
    const button = installWebApp();
    const { result } = renderHook(() =>
      useTelegramMainButton({ label: "Sign permission", onClick: vi.fn() }),
    );

    expect(result.current).toBe(true);
    expect(button.setText).toHaveBeenCalledWith("Sign permission");
    expect(button.hideProgress).toHaveBeenCalledTimes(1);
    expect(button.enable).toHaveBeenCalledTimes(1);
    expect(button.disable).not.toHaveBeenCalled();
    expect(button.show).toHaveBeenCalledTimes(1);
  });

  it("hides the button when there is no action", () => {
    const button = installWebApp();
    renderHook(() => useTelegramMainButton(null));
    expect(button.hide).toHaveBeenCalledTimes(1);
    expect(button.show).not.toHaveBeenCalled();
  });

  it("shows progress and blocks re-entry while busy", () => {
    const button = installWebApp();
    renderHook(() =>
      useTelegramMainButton({ label: "Signing", busy: true, onClick: vi.fn() }),
    );
    expect(button.setText).toHaveBeenCalledWith("Signing");
    expect(button.disable).toHaveBeenCalledTimes(1);
    expect(button.showProgress).toHaveBeenCalledWith(false);
    expect(button.enable).not.toHaveBeenCalled();
  });

  it("registers one handler and always calls the current one", () => {
    const button = installWebApp();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ onClick }) => useTelegramMainButton({ label: "Go", onClick }),
      { initialProps: { onClick: first } },
    );
    rerender({ onClick: second });

    // One registration, not one per render — otherwise every render leaks a
    // listener and a click fires the action several times.
    expect(button.onClick).toHaveBeenCalledTimes(1);
    const handler = button.onClick.mock.calls[0][0] as () => void;
    handler();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it("unregisters and hides on unmount", () => {
    const button = installWebApp();
    const { unmount } = renderHook(() =>
      useTelegramMainButton({ label: "Go", onClick: vi.fn() }),
    );
    const registered = button.onClick.mock.calls[0][0];
    unmount();
    // The exact listener registered on mount must be removed, or it leaks.
    expect(button.offClick).toHaveBeenCalledWith(registered);
    expect(button.hide).toHaveBeenCalledTimes(1);
  });
});
