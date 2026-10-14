"use client";

import { RootProvider } from "fumadocs-ui/provider/tanstack";
import type { ReactNode } from "react";

/** Docs-only provider; marketing routes intentionally avoid loading Fumadocs. */
export function Provider({ children }: { children: ReactNode }) {
  return <RootProvider>{children}</RootProvider>;
}
