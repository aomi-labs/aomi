"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getIdentityToken,
  useCreateWallet,
  useIdentityToken,
  usePrivy,
  type User,
} from "@privy-io/react-auth";
import {
  createAccountSessionProvider,
  type AccountAuthAdapter,
  type AccountAuthSession,
  type AccountSessionProvider,
} from "@aomi-labs/client";

import { aomiBffUrl } from "@/app/config";
import type { LaunchContext } from "@/lib/telegram";

type CanonicalAccountState = {
  error: string | null;
  provider: AccountSessionProvider | null;
  status: "disconnected" | "loading" | "ready" | "error";
  userId: string | null;
};

type TelegramExchangeResponse = {
  access_token?: unknown;
  error?: unknown;
  expires_at?: unknown;
};

function withTimeout<T>(operation: Promise<T>, errorCode: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(errorCode)), 15_000);
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** Privy keeps the identity token in memory *and* in `localStorage`, but only
 *  exposes the in-memory copy through a hook — while `getIdentityToken()`, the
 *  callable one, reads `localStorage`. Mirroring the hook's value here lets the
 *  exchange reach the in-memory copy at call time without the session provider
 *  having to list the token as a dependency: the token rotates, and rebuilding
 *  the provider on each rotation disposes an exchange that is already in
 *  flight. Module scope is safe because Privy permits exactly one provider per
 *  app — it throws on a second one. */
let inMemoryIdentityToken: string | null = null;

function useMirroredIdentityToken(): void {
  const { identityToken } = useIdentityToken();
  useEffect(() => {
    inMemoryIdentityToken = identityToken;
  }, [identityToken]);
}

function telegramPrivyAdapter(input: {
  launch: LaunchContext;
  privySubject: string;
  customUserId: string;
}): AccountAuthAdapter {
  return {
    getFingerprint: () =>
      `telegram:${input.launch.proof?.telegramUserId}:privy:${input.privySubject}:session:${input.launch.sessionId}`,
    exchange: async ({ baseUrl, fetch: fetchImpl }) => {
      // Both sources are read per exchange rather than captured: identity
      // tokens are short lived, and a session provider can outlive the render
      // that built it.
      //
      // Two sources, because neither alone survives a Telegram webview.
      // `getIdentityToken()` refreshes the token against Privy's API, but then
      // reads it back out of `localStorage`, which Telegram's in-app webview
      // can partition or drop — and on Telegram Web the Mini App is an iframe,
      // so that storage is third-party. `useIdentityToken()` reads the
      // in-memory store Privy writes on every `storeIdentityToken`, with no
      // storage involved. Refresh first, so the in-memory value is the fresh
      // one by the time it is read.
      const refreshed = await getIdentityToken().then(
        (token) => ({ failure: null, token }),
        (cause: unknown) => ({
          failure: cause instanceof Error ? cause.message : "unknown",
          token: null,
        }),
      );
      const identityToken = (refreshed.token ?? inMemoryIdentityToken)?.trim();
      if (!input.launch.proof) {
        throw new Error("telegram_privy_launch_proof_unavailable");
      }
      if (!input.launch.sessionId) {
        throw new Error("telegram_privy_session_unavailable");
      }
      if (!identityToken) {
        // Split from the launch-context failures above so staging says which
        // one it hit. Both sources empty after a *successful* refresh means
        // Privy's API returned no `identity_token` at all — it clears the token
        // in that case — which is an app-level setting, not a webview problem.
        throw new Error(
          refreshed.failure
            ? `telegram_privy_identity_token_refresh_failed_${refreshed.failure}`
            : "telegram_privy_identity_token_unavailable",
        );
      }
      const response = await fetchImpl(
        new URL("/api/auth/widget/telegram/exchange", baseUrl),
        {
          method: "POST",
          credentials: "omit",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bot_id: input.launch.proof.botId,
            init_data: input.launch.proof.initData,
            session_id: input.launch.sessionId,
            custom_user_id: input.customUserId,
            credential: {
              provider: "privy",
              environment: "PROD",
              provider_token: identityToken,
            },
          }),
        },
      );
      const body = (await response
        .json()
        .catch(() => null)) as TelegramExchangeResponse | null;
      if (
        !response.ok ||
        typeof body?.access_token !== "string" ||
        typeof body.expires_at !== "number"
      ) {
        // Keep the route's own failure code: a hosted-wallet exchange can fail
        // for reasons the status alone cannot name, and the person staring at
        // the Mini App needs to see which one it was.
        throw new Error(
          typeof body?.error === "string" && body.error
            ? `telegram_privy_exchange_failed_${response.status}_${body.error}`
            : `telegram_privy_exchange_failed_${response.status}`,
        );
      }
      return {
        accessToken: body.access_token,
        expiresAt: body.expires_at,
      } satisfies AccountAuthSession;
    },
  };
}

/** The embedded EVM wallet recorded on the Privy *user*.
 *
 *  This is deliberately not `useWallets()`. That hook answers "is a wallet
 *  connected in this browser", and its `ready` additionally waits on Privy's
 *  wallet-proxy iframe, on the external connectors, and — once the account
 *  already owns an embedded wallet — on that wallet being actively connected.
 *  Inside Telegram's in-app webview, third-party iframe storage is restricted
 *  and that connection routinely never lands, so `ready` stays false forever
 *  on an account whose wallet exists and works.
 *
 *  The exchange never touches the wallet object: it sends an identity token,
 *  and the portal attests the hosted wallet through Privy's server API
 *  (`requireAttestedProviderWallets`). So existence on the user is the real
 *  prerequisite, and `linkedAccounts` reports it without any of that
 *  iframe machinery. */
function linkedEmbeddedWalletAddress(user: User | null): string | null {
  const account = user?.linkedAccounts.find(
    (entry) =>
      entry.type === "wallet" &&
      entry.chainType === "ethereum" &&
      (entry.walletClientType === "privy" ||
        entry.walletClientType === "privy-v2"),
  );
  return account && "address" in account ? account.address : null;
}

/** Ensure the signed-in user has an embedded EVM wallet before the exchange.
 *  `createOnLogin` covers the normal path; this closes the gap for accounts
 *  that predate that config, and answers "wallet exists" as state the exchange
 *  can wait on rather than a race. */
function useEmbeddedWallet(authenticated: boolean) {
  const { user } = usePrivy();
  const { createWallet } = useCreateWallet();
  const [error, setError] = useState<string | null>(null);
  const address = useMemo(() => linkedEmbeddedWalletAddress(user), [user]);
  // One attempt per mount. `createWallet` resolving without a linked wallet
  // appearing must not re-enter, or each pass races Privy's own "already has an
  // embedded wallet" rejection and the hook spins instead of settling.
  const attempted = useRef(false);

  useEffect(() => {
    if (!authenticated || address || attempted.current) return;
    attempted.current = true;
    void withTimeout(createWallet(), "privy_embedded_wallet_timeout").catch(
      (cause: unknown) => {
        // A concurrent create (or one Privy already ran on login) rejects with
        // "already has an embedded wallet"; `user` will carry it shortly, so
        // only a genuine failure should survive — see the return below.
        setError(
          cause instanceof Error
            ? cause.message
            : "privy_embedded_wallet_unavailable",
        );
      },
    );
  }, [address, authenticated, createWallet]);

  return { address, error: address ? null : error };
}

export function useCanonicalAccount(
  launch: LaunchContext | null,
  customAuth: { readyForExchange: boolean; subject: string | null },
): CanonicalAccountState {
  const { authenticated, ready: privyReady, user } = usePrivy();
  const privySubject = user?.id ?? null;
  // Already a stable address rather than an SDK object, so a harmless refresh
  // of Privy's local state cannot dispose an in-flight request.
  const { address: embeddedWalletAddress, error: walletError } =
    useEmbeddedWallet(authenticated && customAuth.readyForExchange);
  // Held in a ref, not a dependency: the token rotates, and rebuilding the
  // provider on each rotation would dispose an exchange that is already in
  // flight. The adapter reads the current value when it actually runs.
  useMirroredIdentityToken();
  const [state, setState] = useState<Omit<CanonicalAccountState, "provider">>({
    error: null,
    status: "disconnected",
    userId: null,
  });

  const provider = useMemo(() => {
    if (
      !privyReady ||
      !authenticated ||
      !customAuth.readyForExchange ||
      !customAuth.subject ||
      !privySubject ||
      !embeddedWalletAddress ||
      !launch?.inTelegram ||
      !launch.proof ||
      !launch.sessionId
    ) {
      return null;
    }
    return createAccountSessionProvider({
      baseUrl: aomiBffUrl,
      adapter: telegramPrivyAdapter({
        launch,
        privySubject,
        customUserId: customAuth.subject,
      }),
    });
  }, [
    authenticated,
    customAuth.readyForExchange,
    customAuth.subject,
    embeddedWalletAddress,
    launch,
    privyReady,
    privySubject,
  ]);

  const resolve = useCallback(
    async (accessToken: string | null | undefined) => {
      if (!accessToken) throw new Error("widget_session_unavailable");
      // Bounded like the exchange above it. This call reaches the backend
      // through the BFF, and the backend's DB pool is deliberately tiny
      // (2 connections per host), so a saturated pool must surface as a named
      // failure rather than a spinner nobody can interpret.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      const response = await fetch(`${aomiBffUrl}/v1/account`, {
        credentials: "omit",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      })
        .catch((cause: unknown) => {
          throw controller.signal.aborted
            ? new Error("canonical_account_timeout")
            : cause;
        })
        .finally(() => clearTimeout(timer));
      if (!response.ok) {
        throw new Error(`canonical_account_failed_${response.status}`);
      }
      const body = (await response.json()) as {
        user?: { id?: unknown } | null;
      };
      if (typeof body.user?.id !== "string") {
        throw new Error("canonical_account_missing");
      }
      return body.user.id;
    },
    [],
  );

  useEffect(() => {
    if (!provider) return;

    let active = true;
    queueMicrotask(() => {
      if (active) setState({ error: null, status: "loading", userId: null });
    });
    void withTimeout(provider(), "telegram_privy_exchange_timeout")
      .then(resolve)
      .then((userId) => {
        if (active) setState({ error: null, status: "ready", userId });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          error:
            error instanceof Error ? error.message : "canonical_account_failed",
          status: "error",
          userId: null,
        });
      });

    return () => {
      active = false;
      provider.dispose();
    };
  }, [provider, resolve]);

  if (walletError) {
    return {
      error: walletError,
      provider: null,
      status: "error",
      userId: null,
    };
  }
  if (authenticated && !provider) {
    // `useMemo` has already evaluated every provider prerequisite this render.
    // Without a provider there is no exchange underway, so this must not claim
    // to be linking. The only prerequisite that can still be pending here is
    // wallet creation, which is bounded and reports its own error above.
    return { error: null, provider: null, status: "disconnected", userId: null };
  }
  return provider
    ? { ...state, provider }
    : { error: null, provider: null, status: "disconnected", userId: null };
}
