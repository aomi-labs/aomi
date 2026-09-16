"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useClient } from "@getpara/react-sdk-lite";
import {
  createProviderCredentialAdapter,
  createAccountSessionProvider,
  type AccountAuthAdapter,
  type AccountAuthSession,
  type AccountSessionProvider,
} from "@aomi-labs/client";

import { aomiBffUrl, paraEnvironment } from "@/app/config";
import type { LaunchContext } from "@/lib/telegram";

type CanonicalAccountState = {
  error: string | null;
  provider: AccountSessionProvider | null;
  status: "disconnected" | "loading" | "ready" | "error";
  userId: string | null;
};

type TelegramExchangeResponse = {
  access_token?: unknown;
  expires_at?: unknown;
};

function telegramParaAdapter(input: {
  getCredential: () => Promise<{
    keyId?: string;
    providerToken: string;
  } | null>;
  launch: LaunchContext;
  paraSubject: string | null;
}): AccountAuthAdapter {
  return {
    getFingerprint: () =>
      input.paraSubject
        ? `telegram:${input.launch.proof?.telegramUserId}:para:${input.paraSubject}:session:${input.launch.sessionId}`
        : null,
    exchange: async ({ baseUrl, fetch: fetchImpl }) => {
      const credential = await input.getCredential();
      if (!credential || !input.launch.proof || !input.launch.sessionId) {
        throw new Error("telegram_para_credential_unavailable");
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
            credential: {
              provider: "para",
              environment: paraEnvironment,
              provider_token: credential.providerToken,
              key_id: credential.keyId,
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
        throw new Error(`telegram_para_exchange_failed_${response.status}`);
      }
      return {
        accessToken: body.access_token,
        expiresAt: body.expires_at,
      } satisfies AccountAuthSession;
    },
  };
}

export function useCanonicalAccount(
  launch: LaunchContext | null,
): CanonicalAccountState {
  const account = useAccount();
  const paraClient = useClient();
  const paraSubject = account.embedded.userId ?? paraClient?.userId ?? null;
  const [state, setState] = useState<Omit<CanonicalAccountState, "provider">>({
    error: null,
    status: "disconnected",
    userId: null,
  });

  const provider = useMemo(() => {
    if (!account.embedded.isConnected || !paraClient || !launch) return null;
    const getCredential = async () => {
      const credential = await paraClient.issueJwt({});
      const providerToken = credential.token.trim();
      return providerToken ? { providerToken, keyId: credential.keyId } : null;
    };
    const adapter =
      launch.inTelegram && launch.proof && launch.sessionId
        ? telegramParaAdapter({ getCredential, launch, paraSubject })
        : createProviderCredentialAdapter({
            provider: "para",
            environment: paraEnvironment,
            getCredential: async () => {
              const credential = await getCredential();
              return credential
                ? {
                    provider: "para",
                    tokenKind: "session_jwt",
                    ...credential,
                  }
                : null;
            },
            getSubject: () => paraSubject,
          });
    return createAccountSessionProvider({ baseUrl: aomiBffUrl, adapter });
  }, [account.embedded.isConnected, launch, paraClient, paraSubject]);

  useEffect(() => {
    if (!provider) return;

    let active = true;
    queueMicrotask(() => {
      if (active) setState({ error: null, status: "loading", userId: null });
    });
    void provider()
      .then(async (accessToken) => {
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
        if (active) {
          setState({ error: null, status: "ready", userId: body.user.id });
        }
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
  }, [provider]);

  return provider
    ? { ...state, provider }
    : { error: null, provider: null, status: "disconnected", userId: null };
}
