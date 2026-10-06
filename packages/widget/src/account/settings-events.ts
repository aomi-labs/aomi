"use client";

import { useEffect, useRef } from "react";

/** Settings modal tabs; `policy` is the Safety tab. */
export type SettingsTab = "general" | "account" | "policy" | "usage";

const OPEN_SETTINGS_EVENT = "aomi:open-settings";

/** Ask the host that owns SettingsModal to open it on `tab`. */
export function requestSettingsOpen(tab: SettingsTab) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<SettingsTab>(OPEN_SETTINGS_EVENT, { detail: tab }),
  );
}

/** Host side of `requestSettingsOpen`: mount once next to SettingsModal. */
export function useSettingsOpenRequest(onOpen: (tab: SettingsTab) => void) {
  const handler = useRef(onOpen);
  handler.current = onOpen;
  useEffect(() => {
    const open = (event: Event) =>
      handler.current((event as CustomEvent<SettingsTab>).detail);
    window.addEventListener(OPEN_SETTINGS_EVENT, open);
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, open);
  }, []);
}
