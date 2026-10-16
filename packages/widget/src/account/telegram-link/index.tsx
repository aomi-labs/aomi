"use client";

import { lazy, Suspense } from "react";
import type { TelegramLinkPanelProps } from "./telegram-link-panel";

export type { TelegramLinkPanelProps } from "./telegram-link-panel";

// Only the portal's /link/telegram page renders it, so it loads on demand,
// off the host-composition bundle.
const Panel = lazy(() =>
  import("./telegram-link-panel").then((module) => ({
    default: module.TelegramLinkPanel,
  })),
);

/** The `/link/telegram` page's sheet: Link Telegram @x?, then Linked. */
export function TelegramLinkPanel(props: TelegramLinkPanelProps) {
  return (
    <Suspense fallback={null}>
      <Panel {...props} />
    </Suspense>
  );
}
