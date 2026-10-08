"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AuthRuntime } from "../composer/types";
import type { AccountConflict, AccountRuntime } from "./types";
import {
  AomiAccountRequestError,
  mergeOfferFrom,
  type AomiBackendAccountResponse,
  type createAomiBackendAccountClient,
} from "./aomi-backend-client";

const FAILED_EXCHANGE_RETRY_MS = 30_000;
const LINK_INTENT_MS = 5 * 60_000;
const LINK_INTENT_KEY = "aomi:provider-link-intent";

type LinkIntent = { accountId: string; provider: string; expiresAt: number };

// Session storage keeps the intent across a login that leaves the page
// (an OAuth redirect) and returns.
function readLinkIntent(): LinkIntent | null {
  try {
    const raw = sessionStorage.getItem(LINK_INTENT_KEY);
    return raw ? (JSON.parse(raw) as LinkIntent) : null;
  } catch {
    return null;
  }
}

function writeLinkIntent(intent: LinkIntent | null) {
  try {
    if (intent) sessionStorage.setItem(LINK_INTENT_KEY, JSON.stringify(intent));
    else sessionStorage.removeItem(LINK_INTENT_KEY);
  } catch {
    // Storage can be unavailable; the click still works within this page.
  }
}

const credentialKey = (credential: unknown) =>
  (JSON.stringify(credential) ?? "").slice(0, 96);
const signedInAs = (auth: Pick<AuthRuntime, "provider" | "subject">) =>
  `${auth.provider}:${auth.subject ?? "unknown"}`;

/**
 * Turn a host sign-in (Privy, Para) into an Aomi account session: link the
 * provider to the current account after an explicit login, or create one.
 * Restored SDK sessions never add a login to an existing account. Each
 * credential is tried once; a failure waits 30 seconds before it is tried again,
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
  const pendingLink = useRef<LinkIntent | null | undefined>(undefined);
  if (pendingLink.current === undefined) pendingLink.current = readLinkIntent();
  const setPendingLink = useCallback((intent: LinkIntent | null) => {
    pendingLink.current = intent;
    writeLinkIntent(intent);
  }, []);
  const latest = useRef(input);
  latest.current = input;

  const loginProvider = useCallback(
    async (reason: string, step?: string) => {
      const current = latest.current;
      if (!current.auth.login)
        throw new Error("Wallet provider sign-in is not ready.");
      // A newly selected provider may still be loading the browser account.
      const target =
        current.enabled && current.status === "loading"
          ? await current.accountClient.getAccount()
          : current.account;
      const intent =
        target?.user && !target.guest
          ? {
              accountId: target.user.id,
              provider: current.auth.provider,
              expiresAt: Date.now() + LINK_INTENT_MS,
            }
          : null;
      setPendingLink(intent);
      exchanged.current = null;
      failed.current = null;
      try {
        if (step === undefined) await current.auth.login(reason);
        else await current.auth.login(reason, step);
      } catch (cause) {
        if (pendingLink.current === intent) setPendingLink(null);
        throw cause;
      }
    },
    [setPendingLink],
  );

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
    // Wait for the account: while it loads, a signed-in browser looks signed
    // out and the exchange would replace its session.
    if (!enabled || status !== "ready" || auth.status !== "authenticated")
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
      const hasAccount = Boolean(account?.user) && account?.guest !== true;
      const attempt = `${hasAccount ? "link" : "session"}:${account?.user?.id ?? "new"}:${signedInAs(auth)}:${key}`;
      if (!hasAccount && creatingAccount.current) return;
      if (
        inFlight.current === attempt ||
        exchanged.current === attempt ||
        (failed.current?.attempt === attempt &&
          Date.now() - failed.current.at < FAILED_EXCHANGE_RETRY_MS)
      )
        return;
      const intent = pendingLink.current;
      const explicitLink = Boolean(
        intent &&
        intent.accountId === account?.user?.id &&
        intent.provider === auth.provider &&
        intent.expiresAt > Date.now(),
      );
      if (!explicitLink) setPendingLink(null);
      if (hasAccount) {
        const matches = account?.linkedAccounts.some(
          (linked) =>
            linked.provider.toLowerCase() === auth.provider.toLowerCase() &&
            linked.subject === auth.subject,
        );
        if (matches) {
          exchanged.current = attempt;
          return;
        }
        // SDK restore is not permission to add someone else's login.
        if (!explicitLink) {
          exchanged.current = attempt;
          await auth.logout?.().catch(() => undefined);
          return;
        }
      }
      setPendingLink(null);
      inFlight.current = attempt;
      if (!hasAccount) creatingAccount.current = attempt;
      try {
        setError(undefined);
        setConflict(undefined);
        const result = await accountClient.exchangeProviderCredential(
          credential,
          { hasAccount },
        );
        exchanged.current = attempt;
        if (result.account) latest.current.onAccount(result.account);
        await latest.current.refresh();
      } catch (cause) {
        const mergeOffer = mergeOfferFrom(cause);
        if (mergeOffer) {
          // The merge sheet answers this; don't offer it again on every refresh.
          exchanged.current = attempt;
          setConflict({
            code: "already_linked_to_another_account",
            signalType: null,
            provider: auth.provider,
            mergeOffer,
          });
          return;
        }
        failed.current = { attempt, at: Date.now() };
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
    setPendingLink(null);
    if (auth.status === "authenticated" && auth.getCredential) {
      const credential = await auth.getCredential().catch(() => null);
      if (credential)
        signedOutCredential.current = `${signedInAs(auth)}:${credentialKey(credential)}`;
    }
    reset();
  }, [auth, reset]);

  return {
    error,
    conflict,
    forgetCredential,
    loginProvider: auth.login ? loginProvider : undefined,
  };
}
