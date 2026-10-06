"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AuthRuntime } from "../composer/types";
import type { AccountConflict, AccountRuntime } from "./types";
import {
  AomiAccountRequestError,
  type AomiBackendAccountResponse,
  type createAomiBackendAccountClient,
} from "./aomi-backend-client";

const FAILED_EXCHANGE_RETRY_MS = 30_000;

const credentialKey = (credential: unknown) =>
  (JSON.stringify(credential) ?? "").slice(0, 96);
const signedInAs = (auth: Pick<AuthRuntime, "provider" | "subject">) =>
  `${auth.provider}:${auth.subject ?? "unknown"}`;

/**
 * Turn a host sign-in (Privy, Para) into an Aomi account session: link the
 * provider to the current account, or create one. Each credential is tried
 * once; a failure waits 30 seconds before the same credential is tried again,
 * and a credential the user signed out of is not used again.
 */
export function useProviderCredentialExchange(input: {
  enabled: boolean;
  auth: AuthRuntime;
  status: AccountRuntime["status"];
  account: AomiBackendAccountResponse | null;
  accountClient: ReturnType<typeof createAomiBackendAccountClient>;
  onAccount: (account: AomiBackendAccountResponse) => void;
  refresh: () => Promise<void>;
  onFailure: () => void;
}) {
  const { enabled, auth, status, account, accountClient } = input;
  const [error, setError] = useState<string>();
  const [conflict, setConflict] = useState<AccountConflict>();
  const signedOutCredential = useRef<string | null>(null);
  const inFlight = useRef<string | null>(null);
  const creatingAccount = useRef<string | null>(null);
  const exchanged = useRef<string | null>(null);
  const failed = useRef<{ attempt: string; at: number } | null>(null);
  const latest = useRef(input);
  latest.current = input;

  const reset = useCallback(() => {
    inFlight.current = null;
    exchanged.current = null;
    failed.current = null;
    setError(undefined);
    setConflict(undefined);
  }, []);

  useEffect(() => {
    if (auth.status === "authenticated") return;
    signedOutCredential.current = null;
    reset();
  }, [auth.status, auth.subject, reset]);

  useEffect(() => {
    if (!enabled || status === "error" || auth.status !== "authenticated")
      return;
    if (!auth.getCredential) return;
    let cancelled = false;
    void (async () => {
      const credential = await auth.getCredential?.().catch(() => null);
      if (!credential || cancelled) return;
      const key = credentialKey(credential);
      if (
        !account?.user &&
        signedOutCredential.current === `${signedInAs(auth)}:${key}`
      )
        return;
      const hasDurableAccount =
        Boolean(account?.user) && account?.guest !== true;
      // The signed-in provider is who is logging in. A browser cookie left by
      // another Para/Privy user must not turn this sign-in into a link
      // attempt: that reports a false conflict and strands the user.
      const replacesStaleBrowserSession = Boolean(
        hasDurableAccount &&
          auth.subject &&
          !account?.linkedAccounts.some(
            (linked) =>
              linked.provider.toLowerCase() === auth.provider.toLowerCase() &&
              linked.subject === auth.subject,
          ),
      );
      // Link to the current account if there is one, otherwise create one.
      const hasAccount = hasDurableAccount && !replacesStaleBrowserSession;
      const attempt = `${hasAccount ? "link" : "session"}:${account?.user?.id ?? "new"}:${key}`;
      if (!hasAccount && creatingAccount.current) return;
      if (
        inFlight.current === attempt ||
        exchanged.current === attempt ||
        (failed.current?.attempt === attempt &&
          Date.now() - failed.current.at < FAILED_EXCHANGE_RETRY_MS)
      )
        return;
      inFlight.current = attempt;
      if (!hasAccount) creatingAccount.current = attempt;
      try {
        setError(undefined);
        setConflict(undefined);
        // Signing in replaces another provider user's session; it is not a
        // link onto it. A guest session stays so the server merges the guest's
        // chats into the account. The live Para/Privy session stays.
        if (replacesStaleBrowserSession) await accountClient.signOut();
        const result = await accountClient.exchangeProviderCredential(
          credential,
          { hasAccount },
        );
        exchanged.current = attempt;
        if (result.account) latest.current.onAccount(result.account);
        await latest.current.refresh();
      } catch (cause) {
        failed.current = { attempt, at: Date.now() };
        if (replacesStaleBrowserSession)
          latest.current.onAccount({
            user: null,
            linkedAccounts: [],
            wallets: [],
            session: null,
          });
        if (
          cause instanceof AomiAccountRequestError &&
          cause.status === 409 &&
          cause.code === "already_linked_to_another_account"
        ) {
          setError(cause.message);
          setConflict({
            code: "already_linked_to_another_account",
            signalType: cause.signalType,
            provider: auth.provider,
          });
        } else {
          setConflict(undefined);
          setError(
            "Your wallet is connected, but Aomi sign-in failed. Try signing in again.",
          );
        }
        latest.current.onFailure();
      } finally {
        if (inFlight.current === attempt) inFlight.current = null;
        if (creatingAccount.current === attempt) creatingAccount.current = null;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    account?.guest,
    account?.user,
    account?.linkedAccounts,
    accountClient,
    auth,
    enabled,
    status,
  ]);

  /** Forget exchange state; the current host credential is not used again. */
  const forgetCredential = useCallback(async () => {
    if (auth.status === "authenticated" && auth.getCredential) {
      const credential = await auth.getCredential().catch(() => null);
      if (credential)
        signedOutCredential.current = `${signedInAs(auth)}:${credentialKey(credential)}`;
    }
    reset();
  }, [auth, reset]);

  return { error, conflict, forgetCredential };
}
