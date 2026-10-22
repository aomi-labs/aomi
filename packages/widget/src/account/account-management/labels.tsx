import type { ReactNode } from "react";
import { LayoutGrid, Pause } from "lucide-react";
import type { WalletFamily } from "@/wallet/types";
import { getAppIcon } from "@/icons/app-map";
import { familyList, plural } from "./wallet-model";

/**
 * The labels every wallet and connection row shares (Settings, sheets and
 * pickers alike): families in the mono face, an app as its logo and name in
 * the grey line, and Paused as a word at the row's end.
 */

/** `EVM`, `EVM/SVM`, an address: always the mono face. */
export function Mono({ children }: { children: ReactNode }) {
  return <span className="type-address">{children}</span>;
}

/** `2 addresses · EVM/SVM` under a parent row's name. */
export function AddressSummary({
  families,
}: {
  families: readonly WalletFamily[];
}) {
  const list = familyList(families);
  return (
    <>
      {plural(families.length, "address", "addresses")}
      {list ? (
        <>
          {" · "}
          <Mono>{list}</Mono>
        </>
      ) : null}
    </>
  );
}

/**
 * The app a wallet is used by, or a connection is locked to: its own logo
 * (the Library's artwork) and name, else the generic app grid.
 */
export function AppLabel({ app }: { app: { name: string; label: string } }) {
  const Icon = getAppIcon(app.name);
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap align-[-2px] font-sans">
      {Icon ? (
        <Icon aria-hidden className="size-3.5 shrink-0 rounded-full" />
      ) : (
        <LayoutGrid aria-hidden className="size-3 shrink-0" />
      )}
      {app.label}
    </span>
  );
}

/** An app's 32px tile in a sheet row: its logo, else the generic app grid. */
export function AppTile({ app }: { app: { name: string; label: string } }) {
  const Icon = getAppIcon(app.name);
  return (
    <span
      aria-hidden
      className="border-aomi-border bg-aomi-surface-2 text-aomi-accent flex size-8 shrink-0 items-center justify-center rounded-[10px] border"
    >
      {Icon ? (
        <Icon className="size-5 rounded-full" />
      ) : (
        <LayoutGrid className="size-4" />
      )}
    </span>
  );
}

/** ` · <AppLabel>` when there is an app, for the end of a grey line. */
export const withApp = (app: { name: string; label: string } | null) =>
  app ? (
    <>
      {" · "}
      <AppLabel app={app} />
    </>
  ) : null;

/** Paused at a row's end, before its buttons. */
export function PausedMeta() {
  return (
    <span className="type-meta text-aomi-danger inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-medium">
      <Pause aria-hidden className="size-3.5" />
      Paused
    </span>
  );
}
