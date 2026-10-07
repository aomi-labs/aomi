"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { withBrowserSessionTransition } from "@aomi-labs/client";
import type { AuthRuntime, SvmWalletRuntime } from "../composer/types";
import type { EvmWalletRuntime } from "../runtime/evm/wallet-runtime";
import type { AccountRuntime, AccountWallet } from "./types";
import {
  createAomiBackendAccountClient,
  type AomiBackendAccountResponse,
} from "./aomi-backend-client";
import {
  useAccountSessionProvider,
  widgetCredentialsReady,
  WalletSignInRequiredError,
  type WidgetAuthConfig,
} from "./use-widget-session-provider";
import { resolveAuthMessageConfig } from "./auth-message";
import {
  normalizeAccountWalletProvider,
  walletAccountKey,
} from "./wallet-labels";
import { linkAccountWallet } from "./wallet-sign-in";
import { useProviderCredentialExchange } from "./provider-exchange";

export type AomiBackendAccountConfig = {
  mode: "aomi-backend";
  baseUrl?: string;
  authDomain?: string;
  authUri?: string;
  widgetAuth?: WidgetAuthConfig;
};

export function useAomiBackendAccountRuntime(input: {
  enabled: boolean;
  baseUrl?: string;
  authDomain?: string;
  authUri?: string;
  widgetAuth?: AomiBackendAccountConfig["widgetAuth"];
  auth: AuthRuntime;
  evm: EvmWalletRuntime;
  svm?: SvmWalletRuntime;
}): AccountRuntime {
  const accountSessionProvider = useAccountSessionProvider({
    baseUrl: input.baseUrl,
    widgetAuth: input.widgetAuth,
    auth: input.auth,
    evm: input.evm,
    svm: input.svm,
  });
  const accountClient = useMemo(
    () =>
      createAomiBackendAccountClient({
        baseUrl: input.baseUrl,
        auth: accountSessionProvider
          ? { credentials: "omit", getAuthorization: accountSessionProvider }
          : { credentials: "include" },
      }),
    [input.baseUrl, accountSessionProvider],
  );
  const authMessageConfig = useMemo(
    () =>
      resolveAuthMessageConfig({
        baseUrl: input.baseUrl,
        authDomain: input.authDomain,
        authUri: input.authUri,
      }),
    [input.authDomain, input.authUri, input.baseUrl],
  );
  // Widget mode is signed-out/idle (not an error) until it has a usable
  // credential source. Provider mode: authenticated + exchangeable credential.
  // Wallet mode: a connected external wallet that can sign. Both layers share
  // `widgetCredentialsReady` so the runtime and the provider builder agree.
  const widgetSignedOut =
    Boolean(input.widgetAuth) &&
    !widgetCredentialsReady({
      widgetAuth: input.widgetAuth as WidgetAuthConfig,
      authStatus: input.auth.status,
      hasAuthCredential: Boolean(input.auth.getCredential),
      evm: input.evm,
      svm: input.svm,
    });
  const [account, setAccount] = useState<AomiBackendAccountResponse | null>(
    null,
  );
  const [status, setStatus] = useState<AccountRuntime["status"]>(
    input.enabled ? (widgetSignedOut ? "ready" : "loading") : "disabled",
  );
  const [errorVersion, setErrorVersion] = useState(0);
  const refreshContextKey = JSON.stringify([
    input.enabled,
    input.widgetAuth?.mode ?? "native",
    input.widgetAuth?.mode === "provider" ? input.widgetAuth.provider : "",
    input.widgetAuth?.mode === "provider" ? input.widgetAuth.environment : "",
    input.auth.status,
    input.auth.provider,
    input.auth.subject ?? "",
    input.evm.activeEvmConnection?.address ?? "",
    input.evm.activeEvmConnection?.chainId ?? "",
    input.svm?.identity(Date.now())?.address ?? "",
    input.svm?.selectedNetwork?.cluster ?? "",
  ]);
  const latestRefreshContext = useRef({ accountClient, refreshContextKey });
  latestRefreshContext.current = { accountClient, refreshContextKey };
  const refreshInFlight = useRef<{
    accountClient: typeof accountClient;
    contextKey: string;
    promise: Promise<void>;
  } | null>(null);

  const refresh = useCallback(async () => {
    if (!input.enabled) return;
    // Widget mode cannot mint a WST before it has a usable credential source
    // (provider: host login; wallet: a connected external signer). Treat that
    // as the normal signed-out state instead of asking the account client for
    // authorization and surfacing a boot error.
    if (widgetSignedOut) {
      refreshInFlight.current = null;
      setAccount(null);
      setStatus("ready");
      return;
    }
    // Two mount effects both trigger the initial fetch; coalesce concurrent
    // calls for the same account and client onto one request.
    const existing = refreshInFlight.current;
    if (
      existing?.accountClient === accountClient &&
      existing.contextKey === refreshContextKey
    ) {
      return existing.promise;
    }
    const entry: NonNullable<typeof refreshInFlight.current> = {
      accountClient,
      contextKey: refreshContextKey,
      promise: Promise.resolve(),
    };
    const run = (async () => {
      setStatus((current) => (current === "ready" ? current : "loading"));
      // Let the entry become visible before invoking the client, including if a
      // test double or future client implementation throws synchronously.
      await Promise.resolve();
      try {
        const next = await accountClient.getAccount();
        const latest = latestRefreshContext.current;
        if (
          latest.accountClient !== accountClient ||
          latest.refreshContextKey !== refreshContextKey
        ) {
          return;
        }
        setAccount(next);
        setStatus("ready");
      } catch (error) {
        const latest = latestRefreshContext.current;
        if (
          latest.accountClient !== accountClient ||
          latest.refreshContextKey !== refreshContextKey
        ) {
          return;
        }
        if (error instanceof WalletSignInRequiredError) {
          setAccount(null);
          setStatus("ready");
          return;
        }
        setStatus("error");
        setErrorVersion((version) => version + 1);
      } finally {
        if (refreshInFlight.current === entry) {
          refreshInFlight.current = null;
        }
      }
    })();
    entry.promise = run;
    refreshInFlight.current = entry;
    return run;
  }, [accountClient, input.enabled, refreshContextKey, widgetSignedOut]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activeEvmAddress =
    input.evm.activeEvmConnection?.address ?? input.evm.activeAccount?.address;
  const activeEvmChainId =
    input.evm.activeEvmConnection?.chainId ?? input.evm.activeAccount?.chainId;
  const activeSvmIdentity = input.svm?.identity(Date.now());
  const activeSvmAccount = input.svm?.activeAccount;
  const activeSvmAddress =
    activeSvmAccount?.address ?? activeSvmIdentity?.address;
  const activeSvmCluster =
    input.svm?.selectedNetwork?.cluster ??
    activeSvmIdentity?.cluster ??
    "solana:mainnet";
  const activeSvmWalletName =
    activeSvmAccount?.walletName ?? activeSvmIdentity?.walletName;
  const activeSvmIsExternal = Boolean(
    activeSvmAddress &&
    activeSvmAccount?.walletKind !== "embedded" &&
    activeSvmAccount?.walletKind !== "smart_account" &&
    activeSvmIdentity?.transport !== "embedded" &&
    activeSvmIdentity?.walletSource !== "embedded",
  );
  const signSolanaMessage = input.svm?.execution.signSolanaMessage;

  useEffect(() => {
    if (input.widgetAuth) void refresh();
  }, [
    activeEvmAddress,
    activeSvmAddress,
    input.auth.status,
    input.auth.subject,
    input.widgetAuth?.mode,
    refresh,
  ]);

  const exchange = useProviderCredentialExchange({
    enabled: input.enabled && !input.widgetAuth,
    auth: input.auth,
    status,
    account,
    accountClient,
    onAccount: setAccount,
    refresh,
    onFailure: () => {
      setStatus("ready");
      setErrorVersion((version) => version + 1);
    },
  });
  const signedOutAccount: AomiBackendAccountResponse = {
    user: null,
    linkedAccounts: [],
    wallets: [],
    session: null,
  };
  const walletSessionSignIn =
    input.widgetAuth?.mode === "wallet"
      ? async () => {
          if (!accountSessionProvider)
            throw new Error("Select this wallet before linking it");
          await accountSessionProvider.signIn();
        }
      : undefined;

  const liveAccounts = useMemo(
    () => [
      ...input.evm.accounts(Date.now()),
      ...(input.svm?.accounts(Date.now()) ?? []),
    ],
    // `errorVersion` intentionally re-samples live wallet adapters after a
    // failed auth/account side effect, because the adapter object identities
    // can stay stable while their internal account snapshots changed.
    [errorVersion, input.evm, input.svm],
  );

  const liveWalletKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const acct of liveAccounts) {
      keys.add(walletAccountKey(acct.family, acct.address));
    }
    return keys;
  }, [liveAccounts]);

  const wallets = useMemo(
    () =>
      (account?.guest ? [] : (account?.wallets ?? [])).map((wallet) => {
        const key = walletAccountKey(wallet.family, wallet.address);
        return {
          ...normalizeAccountWalletProvider(wallet, liveAccounts),
          capability: liveWalletKeys.has(key) ? "write" : "read",
        } satisfies AccountWallet;
      }),
    [account?.guest, account?.wallets, liveAccounts, liveWalletKeys],
  );

  return {
    status: input.enabled ? status : "disabled",
    error: exchange.error,
    conflict: exchange.conflict,
    guest: account?.guest === true,
    guestUserId:
      status === "ready" &&
      account?.guest &&
      account.session?.carrier === "better_auth"
        ? account.session.betterAuthUserId
        : undefined,
    user: account?.guest ? undefined : (account?.user ?? undefined),
    linkedAccounts: account?.guest ? [] : (account?.linkedAccounts ?? []),
    wallets,
    // A connected signer without an account is still a signed-out user.
    // Keep background chat/catalog loaders on their normal guest path until
    // explicit linking or a restored session has resolved the account.
    getAccountBearer:
      input.widgetAuth?.mode === "wallet" && (!account?.user || account.guest)
        ? undefined
        : accountSessionProvider,
    refresh,
    signOut: async () => {
      if (!input.widgetAuth) await exchange.forgetCredential();
      // Cookie sessions sign out through Better Auth; widget sessions revoke
      // themselves and tear down their provider.
      if (accountSessionProvider) await accountSessionProvider.signOut();
      else await accountClient.signOut();
      setAccount(signedOutAccount);
      setStatus("ready");
    },
    deleteAccount: async () => {
      if (!input.widgetAuth) await exchange.forgetCredential();
      // Revoke the widget session too, so the deleted account's token can't
      // be replayed or silently minted again, even if the delete fails.
      try {
        await accountClient.deleteAccount();
      } finally {
        await accountSessionProvider?.signOut();
      }
      setAccount(signedOutAccount);
      setStatus("ready");
    },
    updateAccount: async ({ displayName, avatarUrl }) => {
      await accountClient.updateAccount({ displayName, avatarUrl });
      await refresh();
    },
    linkWallet: async (wallet) => {
      const linked = await linkAccountWallet(
        {
          accountClient,
          account,
          walletSessionSignIn,
          evm: input.evm,
          activeEvmAddress,
          activeEvmChainId,
          svm: {
            address: activeSvmAddress,
            cluster: activeSvmCluster,
            external: activeSvmIsExternal,
            walletName: activeSvmWalletName,
            signMessage: signSolanaMessage,
          },
          messageConfig: authMessageConfig,
        },
        wallet,
      );
      if (linked) setAccount(linked);
      await refresh();
    },
    updateWallet: async ({ walletId, label }) => {
      await accountClient.renameWallet(walletId, label ?? null);
      await refresh();
    },
    updateAuthIdentity: async ({ identityId, displayLabel }) => {
      await accountClient.updateAuthIdentity(identityId, { displayLabel });
      await refresh();
    },
    unlinkWallet: async (walletId) => {
      await accountClient.unlinkWallet(walletId);
      await refresh();
    },
    unlinkAuthIdentity: async (identityId) => {
      await accountClient.unlinkAuthIdentity(identityId);
      await refresh();
    },
    mergeAccount: async (ticket) => {
      const result = await accountClient.mergeAccount(ticket);
      setAccount(result.account);
      await refresh();
      return { chats: result.moved.chats };
    },
    // A new session for another account: the account change that follows
    // drops this account's chats and cached data, as a sign-in does.
    switchToMergeSource: async (ticket) => {
      await withBrowserSessionTransition(() =>
        accountClient.switchToMergeSource(ticket),
      );
      await refresh();
    },
  };
}
