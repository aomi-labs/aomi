"use client";

import { lazy, Suspense } from "react";
import type { ConsentWalletsProps } from "./consent-wallets";

export type {
  ConsentWalletsProps,
  ConsentWalletsState,
} from "./consent-wallets";

// Only the OAuth consent page shows it, so it loads only there.
const Wallets = lazy(() =>
  import("./consent-wallets").then((module) => ({
    default: module.ConsentWallets,
  })),
);

/** The agent wallet part of OAuth consent; see `consent-wallets.tsx`. */
export function ConsentWallets(props: ConsentWalletsProps) {
  return (
    <Suspense fallback={null}>
      <Wallets {...props} />
    </Suspense>
  );
}
