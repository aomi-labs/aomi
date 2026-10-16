"use client";

import { useEffect, useState } from "react";
import { authClient } from "@aomi-labs/widget/browser-auth";
import { useAomiWalletKit } from "@aomi-labs/widget/host-composition";
import { SIGN_RETURN_PARAM, safeReturn } from "@/lib/sign-return";

const STASH_KEY = "aomi.sign.return";

/**
 * Return to a sign link (`/sign/:ref`) or a Telegram link page
 * (`/link/telegram?code=`) once the visitor has signed in. Those pages send
 * signed-out visitors here with `?return_to=`; login flows may rewrite the
 * URL, so the target is stashed on first paint.
 */
export function SignInReturn() {
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    const requested = safeReturn(
      new URLSearchParams(window.location.search).get(SIGN_RETURN_PARAM),
    );
    if (requested) sessionStorage.setItem(STASH_KEY, requested);
    setTarget(safeReturn(sessionStorage.getItem(STASH_KEY)));
  }, []);
  return target ? <PendingReturn target={target} /> : null;
}

function PendingReturn({ target }: { target: string }) {
  const { data } = authClient.useSession();
  const { accountUser, accountGuest } = useAomiWalletKit();
  const signedIn =
    (data?.user && data.user.isAnonymous !== true) ||
    (Boolean(accountUser) && accountGuest === false);
  useEffect(() => {
    if (!signedIn || sessionStorage.getItem(STASH_KEY) !== target) return;
    sessionStorage.removeItem(STASH_KEY);
    window.location.replace(target);
  }, [signedIn, target]);
  return null;
}
