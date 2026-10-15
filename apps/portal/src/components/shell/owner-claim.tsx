"use client";

/**
 * Finishes owner access for a private App opened from Build.
 *
 * Build appends a one-time claim as `#owner_claim=…` to the chat link. This
 * component takes it off the URL at once (so it is not bookmarked, shared or
 * kept in history), holds it for this tab only, and redeems it as soon as the
 * person is signed in. Redeeming grants the signed-in account access to that
 * exact App; no App key is shown or stored in the browser.
 */

import { useEffect, useRef } from "react";
import { useAomiRuntime } from "@aomi-labs/react";
import { useRuntimeAccount } from "@aomi-labs/widget/host-composition";

export const OWNER_CLAIM_FRAGMENT = "owner_claim";
const STORAGE_KEY = "aomi.owner_claim";

/** Read and strip `#owner_claim=` from the current URL. */
export function takeOwnerClaimFromUrl(
  location: Pick<Location, "href" | "hash">,
  history: Pick<History, "replaceState">,
): string | null {
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ""));
  if (!fragment.has(OWNER_CLAIM_FRAGMENT)) return null;
  const claim = fragment.get(OWNER_CLAIM_FRAGMENT)?.trim() || null;
  fragment.delete(OWNER_CLAIM_FRAGMENT);
  const url = new URL(location.href);
  const rest = fragment.toString();
  url.hash = rest ? `#${rest}` : "";
  history.replaceState(null, "", url);
  return claim;
}

function storedClaim(): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeClaim(claim: string | null) {
  try {
    if (claim) window.sessionStorage.setItem(STORAGE_KEY, claim);
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode: the claim then lives only in this component's ref.
  }
}

function errorStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}

export function OwnerClaimRedeemer({ ready }: { ready: boolean }) {
  const {
    account: transport,
    showNotification,
    refreshAccountData,
  } = useAomiRuntime();
  const account = useRuntimeAccount();
  const claimRef = useRef<string | null>(null);
  const promptedRef = useRef(false);
  const redeemingRef = useRef(false);

  useEffect(() => {
    const claim = takeOwnerClaimFromUrl(window.location, window.history);
    if (claim) storeClaim(claim);
    claimRef.current = claim ?? storedClaim();
  }, []);

  useEffect(() => {
    const claim = claimRef.current;
    if (!ready || !claim || account === undefined || redeemingRef.current)
      return;
    if (account?.kind !== "user") {
      if (promptedRef.current) return;
      promptedRef.current = true;
      showNotification({
        type: "notice",
        title: "Sign in to use your private App",
        message:
          "Sign in with your Aomi account to finish setting up owner access. It completes as soon as you sign in.",
      });
      return;
    }
    redeemingRef.current = true;
    void transport
      .redeemOwnerClaim(claim)
      .then(() => {
        showNotification({
          type: "success",
          title: "Owner access ready",
          message:
            "Your account can now chat with this private App. You can revoke it from Settings.",
        });
        refreshAccountData?.();
      })
      .catch((error: unknown) => {
        showNotification({
          type: "error",
          title:
            errorStatus(error) === 404
              ? "Access link expired"
              : "Couldn't set up owner access",
          message:
            errorStatus(error) === 404
              ? "This owner access link was already used or has expired. Open the App from Build again."
              : "Try opening the App from Build again.",
        });
      })
      .finally(() => {
        claimRef.current = null;
        storeClaim(null);
      });
  }, [ready, account, transport, showNotification, refreshAccountData]);

  return null;
}
