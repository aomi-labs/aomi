"use client";

/**
 * Structured debug trace for the wallet/auth lifecycle. Disabled by default;
 * toggle anywhere with:
 *
 *   localStorage.setItem("aomi.wallet.debug", "1")   // force on
 *   localStorage.setItem("aomi.wallet.debug", "0")   // force off
 *
 * Logged via console.info under the `[aomi-wallet]` prefix so a console
 * filter on that string yields a clean timeline.
 */

const DEBUG_KEY = "aomi.wallet.debug";

export function walletDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const flag = window.localStorage.getItem(DEBUG_KEY);
    if (flag === "1" || flag === "true") return true;
    if (flag === "0" || flag === "false") return false;
  } catch {
    // fall through to the default
  }
  return false;
}

export function walletDebug(
  event: string,
  data?: Record<string, unknown>,
): void {
  if (!walletDebugEnabled()) return;
  if (data === undefined) {
    console.info(`[aomi-wallet] ${event}`);
  } else {
    console.info(`[aomi-wallet] ${event}`, data);
  }
}
