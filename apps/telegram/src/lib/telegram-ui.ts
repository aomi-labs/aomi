"use client";

import { useEffect } from "react";

export function webApp(): TelegramWebApp | undefined {
  return typeof window === "undefined" ? undefined : window.Telegram?.WebApp;
}

/** Telegram clients ship whatever SDK version they ship, so every call beyond
 *  the original surface has to be feature-checked. `isVersionAtLeast` is itself
 *  only present from 6.1, hence the optional call. */
function supports(app: TelegramWebApp | undefined, version: string): boolean {
  return app?.isVersionAtLeast?.(version) === true;
}

export function haptic(type: "error" | "success" | "warning"): void {
  try {
    webApp()?.HapticFeedback?.notificationOccurred(type);
  } catch {
    // Haptics are decoration; an older client throwing must never break a flow.
  }
}

export function closeApp(): void {
  try {
    webApp()?.close();
  } catch {
    // Nothing to fall back to — the user can dismiss the sheet themselves.
  }
}

/** Adopt Telegram's own window chrome, and keep the Aomi theme in step with the
 *  client's light/dark choice.
 *
 *  `disableVerticalSwipes` matters more than it looks: without it a vertical
 *  drag anywhere in the page — including inside Privy's modal or over the OTP
 *  field — collapses the Mini App, which in this app means collapsing it in the
 *  middle of a signing ceremony. */
export function useTelegramChrome(): void {
  useEffect(() => {
    const app = webApp();
    if (!app) return;

    if (supports(app, "7.7")) app.disableVerticalSwipes?.();
    // A half-finished link or permit is worth one extra tap to abandon.
    if (supports(app, "6.2")) app.enableClosingConfirmation?.();

    const applyTheme = () => {
      // The theme is light-first with a `.dark` override, exactly as the portal
      // uses it. Telegram's default is dark, which is also ours.
      document.documentElement.classList.toggle(
        "dark",
        app.colorScheme !== "light",
      );
    };
    applyTheme();
    // Telegram fires this when the user switches theme mid-session; without it
    // the app keeps whatever palette it booted with.
    app.onEvent?.("themeChanged", applyTheme);
    return () => app.offEvent?.("themeChanged", applyTheme);
  }, []);
}

/** Wire Telegram's native back button to `onBack`, or hide it when null.
 *  Multi-step flows without this are a dead end: the only way out of a stage is
 *  to close the whole Mini App. */
export function useTelegramBackButton(onBack: (() => void) | null): void {
  useEffect(() => {
    const button = webApp()?.BackButton;
    if (!button) return;
    if (!onBack) {
      button.hide();
      return;
    }
    button.onClick(onBack);
    button.show();
    return () => {
      button.offClick(onBack);
      button.hide();
    };
  }, [onBack]);
}
