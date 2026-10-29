"use client";

import { useEffect, useEffectEvent, type ReactNode } from "react";
import Link from "next/link";
import {
  AomiButton,
  AomiLogo,
  AomiSheet,
  LoadingPane,
  SheetFootnote,
  SheetHeader,
  useAomiWalletKit,
  useWalletPicker,
  WalletPicker,
  WalletPickerProvider,
  WidgetScope,
  type SheetPurpose,
} from "@aomi-labs/widget/host-composition";

/**
 * A connect or sign page: the page background, a small Aomi wordmark and one
 * sheet. Signed out (or a guest, unless `guest` allows it), the page opens
 * the real wallet picker with `purpose`; once the session lands the picker
 * closes and `children` (the page's own sheet) takes its place.
 */
export function StandalonePage(props: {
  purpose: SheetPurpose;
  /** A guest session is enough for this page. */
  guest?: boolean;
  /** The page signs with a wallet, so it waits for the providers to boot. */
  needsWallet?: boolean;
  /** Under "Sign in" when the picker was closed signed out. */
  footnote?: ReactNode;
  children: ReactNode;
}) {
  return (
    <WidgetScope>
      <WalletPickerProvider>
        <main className="bg-aomi-bg text-aomi-fg relative h-full w-full">
          <Link
            href="/"
            aria-label="Aomi"
            className="absolute left-5 top-4 text-[17px]"
          >
            <AomiLogo />
          </Link>
          <Gate {...props} />
        </main>
        <WalletPicker backdrop={false} />
      </WalletPickerProvider>
    </WidgetScope>
  );
}

function Gate({
  purpose,
  guest = false,
  needsWallet = false,
  footnote,
  children,
}: Parameters<typeof StandalonePage>[0]) {
  const { accountUser, accountGuest, accountStatus, isReady } =
    useAomiWalletKit();
  const { open, openPicker } = useWalletPicker();
  // A signed-in account is enough to show a page that doesn't sign; a
  // signed-out visit waits for the wallet providers, so the picker opens on
  // the real state.
  const restoring =
    accountStatus === "loading" ||
    (isReady === false && (needsWallet || !accountUser));
  const signedIn = Boolean(accountUser && (guest || !accountGuest));
  // Opens once per sign-out; closing it leaves the Sign in sheet below. A new
  // opener or purpose alone never re-opens it.
  const openSignIn = useEffectEvent(() => openPicker({ purpose }));
  useEffect(() => {
    if (!restoring && !signedIn) openSignIn();
  }, [restoring, signedIn]);

  if (open) return null;
  if (restoring)
    return <LoadingPane label="Loading" className="absolute inset-0" />;
  if (signedIn) return <>{children}</>;
  return (
    <AomiSheet backdrop={false}>
      <SheetHeader
        title="Sign in to Aomi"
        description={purpose.text}
        onClose={() => window.location.assign("/")}
      />
      <div className="flex flex-col gap-4 px-5 pb-5">
        <AomiButton
          variant="primary"
          className="h-10 w-full"
          onClick={() => openPicker({ purpose })}
        >
          Sign in
        </AomiButton>
        {footnote ? <SheetFootnote>{footnote}</SheetFootnote> : null}
      </div>
    </AomiSheet>
  );
}
