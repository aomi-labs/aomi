"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getEmbeddedConnectedWallet,
  getIdentityToken,
  useCreateWallet,
  usePrivy,
  useWallets,
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

function telegramPrivyAdapter(input: {
  launch: LaunchContext;
  privySubject: string;
  customUserId: string;
}): AccountAuthAdapter {
  return {
    getFingerprint: () =>
      `telegram:${input.launch.proof?.telegramUserId}:privy:${input.privySubject}:session:${input.launch.sessionId}`,
    exchange: async ({ baseUrl, fetch: fetchImpl }) => {
      // Fetched per exchange rather than captured: identity tokens are short
      // lived, and a session provider can outlive the render that built it.
      const identityToken = (await getIdentityToken())?.trim();
      if (!identityToken || !input.launch.proof || !input.launch.sessionId) {
        throw new Error("telegram_privy_credential_unavailable");
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

/** Ensure the signed-in user has an embedded EVM wallet before the exchange.
 *  `createOnLogin` covers the normal path; this closes the gap for accounts
 *  that predate that config, and answers "wallet exists" as state the exchange
 *  can wait on rather than a race. */
function useEmbeddedWallet(authenticated: boolean) {
  const { wallets, ready } = useWallets();
  const { createWallet } = useCreateWallet();
  const [error, setError] = useState<string | null>(null);
  const wallet = useMemo(
    () => (ready ? getEmbeddedConnectedWallet(wallets) : null),
    [ready, wallets],
  );
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!authenticated || !ready || wallet || creating || error) return;
    queueMicrotask(() => {
      setCreating(true);
      void withTimeout(createWallet(), "privy_embedded_wallet_timeout")
        .catch((cause: unknown) => {
          // A concurrent create (or one Privy already ran on login) rejects with
          // "already has an embedded wallet"; `wallets` will carry it shortly, so
          // only a genuine failure should surface.
          setError(
            cause instanceof Error
              ? cause.message
              : "privy_embedded_wallet_unavailable",
          );
        })
        .finally(() => setCreating(false));
    });
  }, [authenticated, createWallet, creating, error, ready, wallet]);

  return { error: wallet ? null : error, wallet };
}

export function useCanonicalAccount(
  launch: LaunchContext | null,
  customAuth: { readyForExchange: boolean; subject: string | null },
): CanonicalAccountState {
  const { authenticated, ready: privyReady, user } = usePrivy();
  const privySubject = user?.id ?? null;
  const { error: walletError, wallet } = useEmbeddedWallet(
    authenticated && customAuth.readyForExchange,
  );
  // Privy can return a fresh wallet object when local SDK state changes. The
  // session provider only needs a wallet to exist; key it by the stable address
  // so a harmless object refresh cannot dispose an in-flight request.
  const embeddedWalletAddress = wallet?.address ?? null;
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
      const response = await fetch(`${aomiBffUrl}/v1/account`, {
        credentials: "omit",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      });
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
    return { error: null, provider: null, status: "loading", userId: null };
  }
  return provider
    ? { ...state, provider }
    : { error: null, provider: null, status: "disconnected", userId: null };
}
