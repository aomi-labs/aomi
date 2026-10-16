"use client";

import { lazy, Suspense } from "react";
import type { CommitSignPanelProps } from "./commit-sign-panel";

export type { CommitSignPanelProps } from "./commit-sign-panel";

// Only the portal's /sign/:ref page renders it, so it loads on demand, off
// the host-composition bundle.
const Panel = lazy(() =>
  import("./commit-sign-panel").then((module) => ({
    default: module.CommitSignPanel,
  })),
);

/** The `/sign/:ref` page's sheet: the review, then a tick, an expiry or the lock. */
export function CommitSignPanel(props: CommitSignPanelProps) {
  return (
    <Suspense fallback={null}>
      <Panel {...props} />
    </Suspense>
  );
}
