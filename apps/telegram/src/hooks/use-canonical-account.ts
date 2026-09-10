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
  error?: unknown;
  expires_at?: unknown;
};

type ParaWalletClient = {
  createWalletPerType: (input: { types: ["EVM"] }) => Promise<unknown>;
  getWalletsByType: (type: "EVM") => unknown[];
};

type WalletProvisionState =
  | { status: "disconnected" | "provisioning" | "ready" }
  | { error: string; status: "error" };

// React can restart an effect while a connected Para client is still creating
// its first wallet. Share that work so the account never gets two EVM wallets.
const evmWalletProvisioning = new WeakMap<
  ParaWalletClient,
  Promise<void>
>();

async function ensureEvmWallet(client: ParaWalletClient): Promise<void> {
  if (client.getWalletsByType("EVM").length > 0) return;

  let provisioning = evmWalletProvisioning.get(client);
  if (!provisioning) {
    provisioning = client
      .createWalletPerType({ types: ["EVM"] })
      .then(() => {
        if (client.getWalletsByType("EVM").length === 0) {
          throw new Error("para_embedded_wallet_unavailable");
        }
      })
      .finally(() => {
        evmWalletProvisioning.delete(client);
      });
    evmWalletProvisioning.set(client, provisioning);
  }
  await provisioning;
}

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
        // Keep the route's own failure code: a hosted-wallet exchange can fail
        // for reasons the status alone cannot name (Para attests no embedded
        // wallet, the Para API is down, no server secret is configured), and
        // the person staring at the Mini App needs to see which one it was.
        throw new Error(
          typeof body?.error === "string" && body.error
            ? `telegram_para_exchange_failed_${response.status}_${body.error}`
            : `telegram_para_exchange_failed_${response.status}`,
        );
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
  const [walletProvision, setWalletProvision] = useState<WalletProvisionState>({
    status: "disconnected",
  });
  const [state, setState] = useState<Omit<CanonicalAccountState, "provider">>({
    error: null,
    status: "disconnected",
    userId: null,
  });

  useEffect(() => {
    if (!account.embedded.isConnected || !paraClient) {
      queueMicrotask(() => setWalletProvision({ status: "disconnected" }));
      return;
    }

    let active = true;
    queueMicrotask(() => {
      if (active) setWalletProvision({ status: "provisioning" });
    });
    void ensureEvmWallet(paraClient)
      .then(() => {
        if (active) setWalletProvision({ status: "ready" });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setWalletProvision({
          error:
            error instanceof Error
              ? error.message
              : "para_embedded_wallet_provision_failed",
          status: "error",
        });
      });

    return () => {
      active = false;
    };
  }, [account.embedded.isConnected, paraClient]);

  const provider = useMemo(() => {
    if (
      !account.embedded.isConnected ||
      !paraClient ||
      !launch ||
      walletProvision.status !== "ready"
    ) {
      return null;
    }
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
  }, [
    account.embedded.isConnected,
    launch,
    paraClient,
    paraSubject,
    walletProvision.status,
  ]);

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

  if (walletProvision.status === "error") {
    return {
      error: walletProvision.error,
      provider: null,
      status: "error",
      userId: null,
    };
  }
  if (
    account.embedded.isConnected &&
    paraClient &&
    walletProvision.status === "provisioning"
  ) {
    return { error: null, provider: null, status: "loading", userId: null };
  }
  return provider
    ? { ...state, provider }
    : { error: null, provider: null, status: "disconnected", userId: null };
}
