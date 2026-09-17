"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePrivy, useSessionSigners } from "@privy-io/react-auth";
import type { AccountSessionProvider } from "@aomi-labs/client";

import { aomiBffUrl } from "@/app/config";
import { embeddedWallet, type EmbeddedWallet } from "@/lib/privy-wallet";
import type { LaunchContext } from "@/lib/telegram";

export type DelegationStatus =
  | "idle"
  | "ready"
  | "delegating"
  | "done"
  | "error";

export type DelegationState = {
  status: DelegationStatus;
  error: string | null;
  delegate: () => Promise<void>;
};

type BeginResponse = { auth_url?: unknown; state_token?: unknown };

/** Grant Aomi's backend the right to sign with the user's embedded wallet.
 *
 *  Without this, `server_auto` is not merely unenforced — it is unreachable.
 *  The backend's `check_auto_preconditions` requires an active
 *  `signing_delegations` row covering the exact key, and it runs at *challenge*
 *  time, not commit, so a Mini App that has never delegated cannot even obtain
 *  a permit to sign: the challenge answers 409 `missing_delegated_account`.
 *
 *  The ceremony mirrors the portal's `PrivyDelegationProvider`: ask Aomi which
 *  signer to install, install it through Privy, then let Aomi's callback verify
 *  the result against Privy's own API. The callback is authoritative — Privy
 *  reports an already-installed signer as an error, which is a success for our
 *  purposes and must not fail the flow.
 */
export function usePrivyDelegation(input: {
  launch: LaunchContext | null;
  provider: AccountSessionProvider | null;
  wallet: EmbeddedWallet | null;
  /** A live backend delegation, restored when the Mini App is reopened. */
  delegated?: boolean;
}): DelegationState {
  const { getAccessToken, user } = usePrivy();
  const { addSessionSigners } = useSessionSigners();
  const [status, setStatus] = useState<DelegationStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  // Held in a ref for the same reason the permit ceremony does it: installing a
  // session signer puts a Privy round trip between the `begin` call and the
  // callback, and a provider rebuilt in that window would otherwise strand a
  // delegation that has already been granted on Privy's side.
  const providerRef = useRef(input.provider);
  useEffect(() => {
    providerRef.current = input.provider;
  }, [input.provider]);

  const delegate = useCallback(async () => {
    const provider = providerRef.current;
    const wallet = input.wallet;
    const threadId = input.launch?.sessionId;
    if (!provider || !wallet || !threadId) {
      setError(
        !threadId
          ? "delegation_thread_unavailable"
          : "delegation_session_unavailable",
      );
      setStatus("error");
      return;
    }

    setStatus("delegating");
    setError(null);
    try {
      const token = await provider();
      const beginResponse = await fetch(
        `${aomiBffUrl}/api/delegation/privy/begin`,
        {
          method: "POST",
          credentials: "omit",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            // The backend's begin endpoint is thread-authed; the Mini App's
            // launch `session_id` *is* the canonical thread id.
            "X-Thread-Id": threadId,
          },
          body: JSON.stringify({
            wallet_family: "evm",
            purpose: "delegate_signing",
          }),
        },
      );
      const begin = (await beginResponse
        .json()
        .catch(() => null)) as BeginResponse | null;
      if (
        !beginResponse.ok ||
        typeof begin?.auth_url !== "string" ||
        typeof begin.state_token !== "string"
      ) {
        throw new Error(`delegation_begin_failed_${beginResponse.status}`);
      }
      // Privy's `delegated` bit only says its signer is installed. It does not
      // prove that Aomi received the callback which persists the matching
      // server-side delegation. Always reconcile through the callback; only
      // skip the duplicate Privy signer installation for a returning wallet.
      let signerFailure: string | null = null;
      let walletId = wallet.id;
      let privyUserId = user?.id;
      if (!wallet.delegated) {
        const signerId = new URL(begin.auth_url).searchParams
          .get("signer_id")
          ?.trim();
        if (!signerId) throw new Error("delegation_signer_unconfigured");
        // Privy rejects a signer that is already installed. The Aomi callback
        // verifies the real state against Privy's API, so that rejection is not
        // terminal here — keep it to explain a callback failure should
        // reconciliation be rejected too.
        const granted = await addSessionSigners({
          address: wallet.address,
          signers: [{ signerId, policyIds: [] }],
        }).catch((cause: unknown) => {
          signerFailure = cause instanceof Error ? cause.message : "unknown";
          return null;
        });
        // Privy only assigns a server wallet id once the wallet is delegated,
        // so the freshly returned user carries it when the pre-call snapshot
        // did not.
        walletId = embeddedWallet(granted?.user ?? null)?.id ?? wallet.id;
        privyUserId = granted?.user.id ?? user?.id;
      }
      const accessToken = await getAccessToken();
      if (!accessToken || !privyUserId || !walletId) {
        throw new Error(
          signerFailure
            ? `delegation_signer_rejected_${signerFailure}`
            : "delegation_wallet_unavailable",
        );
      }

      const callbackResponse = await fetch(
        `${aomiBffUrl}/api/delegation/privy/callback`,
        {
          method: "POST",
          credentials: "omit",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            state: begin.state_token,
            access_token: accessToken,
            user_id: privyUserId,
            wallets: [
              {
                id: walletId,
                address: wallet.address,
                chain_type: "ethereum",
              },
            ],
          }),
        },
      );
      if (!callbackResponse.ok) {
        const payload = (await callbackResponse.json().catch(() => null)) as {
          error?: unknown;
        } | null;
        const because = signerFailure ? ` (${signerFailure})` : "";
        throw new Error(
          typeof payload?.error === "string"
            ? `${payload.error}${because}`
            : `delegation_failed_${callbackResponse.status}${because}`,
        );
      }
      setStatus("done");
    } catch (cause) {
      // The error is state, not an exception: this runs from a click handler,
      // where a rejected promise would surface as an unhandled rejection and
      // tell the user nothing.
      setError(cause instanceof Error ? cause.message : "delegation_failed");
      setStatus("error");
    }
  }, [addSessionSigners, getAccessToken, input.launch, input.wallet, user]);

  const settled = status !== "idle";
  return {
    delegate,
    error,
    // A Privy-side signer still needs the Aomi callback before it is usable
    // for server signing, so all wallets with the needed local prerequisites
    // remain actionable until this hook's callback succeeds.
    status: settled
      ? status
      : input.delegated
        ? "done"
        : input.provider && input.wallet && input.launch?.sessionId
          ? "ready"
          : "idle",
  };
}
