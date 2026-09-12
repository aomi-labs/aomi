"use client";

import { useEffect, useRef } from "react";

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

/** Drive Telegram's native bottom button, and say whether it took the job.
 *
 *  The MainButton is the thumb-reachable, platform-native place for the one
 *  action a screen offers, which is exactly the shape of this page. It is not
 *  unconditionally better, though: outside Telegram — a browser preview, or any
 *  client too old to have it — there is no button at all, and a page whose only
 *  action lives there would be a dead end. So this reports ownership, and the
 *  caller keeps rendering its own button whenever the answer is false.
 *
 *  `null` means "no action right now" and hides the button.
 */
export function useTelegramMainButton(
  action: { label: string; busy?: boolean; onClick: () => void } | null,
): boolean {
  const button = webApp()?.MainButton;
  // The handler identity changes every render; registering it directly would
  // leak a listener per render. Register once, read the current one through a
  // ref.
  const onClick = useRef(action?.onClick);
  useEffect(() => {
    onClick.current = action?.onClick;
  });

  const label = action?.label ?? null;
  const busy = action?.busy ?? false;

  useEffect(() => {
    if (!button) return;
    const handler = () => onClick.current?.();
    button.onClick(handler);
    return () => {
      button.offClick(handler);
      button.hide();
    };
  }, [button]);

  useEffect(() => {
    if (!button) return;
    if (!label) {
      button.hide();
      return;
    }
    button.setText(label);
    if (busy) {
      button.disable();
      button.showProgress(false);
    } else {
      button.hideProgress();
      button.enable();
    }
    button.show();
  }, [busy, button, label]);

  return Boolean(button);
}
