"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildSiwsMessage } from "@aomi-labs/client";
import type { AuthRuntime, SvmWalletRuntime } from "../composer/types";
import type { EvmWalletRuntime } from "../runtime/evm/wallet-runtime";
import { brandDisplayName } from "../runtime/evm/brands";
import type { AccountRuntime, AccountWallet } from "./types";
import type { AomiAccount, SvmCluster, WalletFamily } from "../types";
import {
  AomiAccountRequestError,
  createAomiBackendAccountClient,
  type AomiBackendAccountResponse,
  type AomiBackendNonceResponse,
} from "./aomi-backend-client";
import {
  useAccountSessionProvider,
  widgetCredentialsReady,
  type WidgetAuthConfig,
} from "./use-widget-session-provider";
import { utf8ToBase64 } from "./encoding";

export type AomiBackendAccountConfig = {
  mode: "aomi-backend";
  baseUrl?: string;
  authDomain?: string;
  authUri?: string;
  widgetAuth?: WidgetAuthConfig;
};

const CREDENTIAL_EXCHANGE_FAILURE_COOLDOWN_MS = 30_000;

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
  const [accountError, setAccountError] = useState<string | undefined>();
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
  const walletLabelSyncInFlight = useRef<string | null>(null);
  const accountCreateInFlight = useRef<string | null>(null);
  const signedOutCredentialKey = useRef<string | null>(null);
  const credentialInFlight = useRef<string | null>(null);
  const credentialExchanged = useRef<string | null>(null);
  const providerSessionAttempted = useRef<string | null>(null);
  const credentialFailed = useRef<{
    attemptKey: string;
    failedAt: number;
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
    // calls for the same principal/client onto one in-flight promise.
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
      } catch {
        const latest = latestRefreshContext.current;
        if (
          latest.accountClient !== accountClient ||
          latest.refreshContextKey !== refreshContextKey
        ) {
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

  useEffect(() => {
    if (input.auth.status !== "authenticated") {
      signedOutCredentialKey.current = null;
      credentialInFlight.current = null;
      credentialExchanged.current = null;
      providerSessionAttempted.current = null;
      credentialFailed.current = null;
      setAccountError(undefined);
    }
  }, [input.auth.status, input.auth.subject]);

  const activeEvmAddress =
    input.evm.activeEvmConnection?.address ?? input.evm.activeAccount?.address;
  const activeEvmChainId =
    input.evm.activeEvmConnection?.chainId ?? input.evm.activeAccount?.chainId;
  const activeEvmWalletName = activeEvmAddress
    ? resolveLinkedWalletName({
        accounts: input.evm.accounts(Date.now()),
        accountId: input.evm.activeAccount?.id,
        address: activeEvmAddress,
        fallbackWalletName:
          input.evm.activeAccount?.walletName ??
          input.evm.activeEvmConnection?.walletName,
      })
    : undefined;
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

  useEffect(() => {
    if (!account?.user || account.guest || !activeEvmAddress) return;
    const brand = brandDisplayName(activeEvmWalletName);
    if (brand === "Wallet") return;
    const wallet = account.wallets.find(
      (candidate) =>
        candidate.family === "evm" &&
        candidate.address.toLowerCase() === activeEvmAddress.toLowerCase() &&
        !candidate.label?.trim(),
    );
    if (!wallet) return;
    const label = buildDefaultWalletLabel({
      walletName: brand,
      existingWallets: account.wallets,
      family: "evm",
    });
    const key = `${wallet.id}:${label}`;
    if (walletLabelSyncInFlight.current === key) return;
    walletLabelSyncInFlight.current = key;
    accountClient
      .updateWallet(wallet.id, { label })
      .then(refresh)
      .catch(() => setErrorVersion((version) => version + 1))
      .finally(() => {
        if (walletLabelSyncInFlight.current === key) {
          walletLabelSyncInFlight.current = null;
        }
      });
  }, [account, accountClient, activeEvmAddress, activeEvmWalletName, refresh]);

  useEffect(() => {
    if (
      !input.enabled ||
      Boolean(input.widgetAuth) ||
      status === "error" ||
      input.auth.status !== "authenticated"
    ) {
      return;
    }
    if (!input.auth.getCredential) return;
    let cancelled = false;
    async function exchange() {
      const authKey = authSessionKey(input.auth);
      const credential = await input.auth.getCredential?.().catch(() => null);
      if (!credential || cancelled) {
        if (!cancelled) providerSessionAttempted.current = authKey;
        return;
      }
      const key = credentialKey(credential);
      const signedOutKey = authCredentialKey(input.auth, key);
      if (!account?.user && signedOutCredentialKey.current === signedOutKey) {
        providerSessionAttempted.current = authKey;
        return;
      }
      // Any provider credential is exchangeable, in any order: link to the
      // current account if one exists, otherwise create one. No policy gate.
      const hasAccount = Boolean(account?.user) && account?.guest !== true;
      const attemptKey = `${hasAccount ? "link" : "session"}:${account?.user?.id ?? "new"}:${key}`;
      if (!hasAccount && accountCreateInFlight.current) return;
      const failedAttempt = credentialFailed.current;
      if (
        credentialInFlight.current === attemptKey ||
        credentialExchanged.current === attemptKey ||
        (failedAttempt?.attemptKey === attemptKey &&
          Date.now() - failedAttempt.failedAt <
            CREDENTIAL_EXCHANGE_FAILURE_COOLDOWN_MS)
      ) {
        return;
      }
      credentialInFlight.current = attemptKey;
      if (!hasAccount) accountCreateInFlight.current = attemptKey;
      try {
        setAccountError(undefined);
        // Provider sign-in is an account transition, not a link operation on
        // the disposable guest. Revoke the guest cookie before the Better Auth
        // provider endpoint establishes the durable session.
        if (account?.guest) await accountClient.signOut();
        const result = await accountClient.exchangeProviderCredential(
          credential,
          { hasAccount },
        );
        credentialExchanged.current = attemptKey;
        if (result.account) setAccount(result.account);
        await refresh();
      } catch (error) {
        credentialFailed.current = { attemptKey, failedAt: Date.now() };
        if (
          error instanceof AomiAccountRequestError &&
          error.status === 409 &&
          error.code === "already_linked_to_another_account"
        ) {
          setAccountError(error.message);
        } else {
          setAccountError(
            "Your wallet is connected, but Aomi sign-in failed. Try signing in again.",
          );
        }
        setStatus("ready");
        setErrorVersion((version) => version + 1);
      } finally {
        providerSessionAttempted.current = authKey;
        if (credentialInFlight.current === attemptKey) {
          credentialInFlight.current = null;
        }
        if (accountCreateInFlight.current === attemptKey) {
          accountCreateInFlight.current = null;
        }
      }
    }
    void exchange();
    return () => {
      cancelled = true;
    };
  }, [
    account?.guest,
    account?.user,
    accountClient,
    input.auth,
    input.enabled,
    refresh,
    status,
  ]);

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
    error: accountError,
    guest: account?.guest === true,
    user: account?.guest ? undefined : (account?.user ?? undefined),
    linkedAccounts: account?.guest ? [] : (account?.linkedAccounts ?? []),
    wallets,
    getAccountBearer: accountSessionProvider,
    refresh,
    signOut: async () => {
      if (
        !input.widgetAuth &&
        input.auth.status === "authenticated" &&
        input.auth.getCredential
      ) {
        const credential = await input.auth.getCredential().catch(() => null);
        if (credential) {
          signedOutCredentialKey.current = authCredentialKey(
            input.auth,
            credentialKey(credential),
          );
        }
      }
      credentialInFlight.current = null;
      credentialExchanged.current = null;
      providerSessionAttempted.current = null;
      credentialFailed.current = null;
      setAccountError(undefined);
      // Cookie sessions sign out through Better Auth. Widget sessions own
      // their canonical revocation and provider teardown, avoiding a second
      // revocation through the retired compatibility facade.
      if (accountSessionProvider) {
        await accountSessionProvider.signOut();
      } else {
        await accountClient.signOut();
      }
      setAccount({
        user: null,
        linkedAccounts: [],
        wallets: [],
        session: null,
      });
      setStatus("ready");
    },
    deleteAccount: async () => {
      if (
        !input.widgetAuth &&
        input.auth.status === "authenticated" &&
        input.auth.getCredential
      ) {
        const credential = await input.auth.getCredential().catch(() => null);
        if (credential) {
          signedOutCredentialKey.current = authCredentialKey(
            input.auth,
            credentialKey(credential),
          );
        }
      }
      credentialInFlight.current = null;
      credentialExchanged.current = null;
      providerSessionAttempted.current = null;
      credentialFailed.current = null;
      setAccountError(undefined);
      // Mirror signOut: revoke the widget session too so the just-deleted
      // account's cached WST can't be replayed or silently re-minted on a
      // force-refresh. Always run the widget teardown even if delete throws.
      try {
        await accountClient.deleteAccount();
      } finally {
        await accountSessionProvider?.signOut();
      }
      setAccount({
        user: null,
        linkedAccounts: [],
        wallets: [],
        session: null,
      });
      setStatus("ready");
    },
    updateAccount: async ({ displayName, avatarUrl }) => {
      await accountClient.updateAccount({ displayName, avatarUrl });
      await refresh();
    },
    linkWallet: async (wallet) => {
      if (wallet.family === "svm") {
        if (
          !activeSvmAddress ||
          wallet.address !== activeSvmAddress ||
          !activeSvmIsExternal ||
          !signSolanaMessage
        ) {
          throw new Error(
            "Wallet linking requires the active external Solana signer",
          );
        }
        const label = buildDefaultWalletLabel({
          walletName: activeSvmWalletName,
          existingWallets: account?.wallets ?? [],
          family: "svm",
        });
        await authenticateSvmWallet({
          accountClient,
          address: wallet.address,
          chainId: activeSvmCluster,
          intent: account?.user && !account.guest ? "link" : "sign-in",
          replaceGuestSession: account?.guest
            ? () => accountClient.signOut()
            : undefined,
          label,
          messageConfig: authMessageConfig,
          signMessage: (message) =>
            signMessageWithActiveSvm(
              signSolanaMessage,
              message,
              activeSvmCluster,
            ),
        });
        await refresh();
        return;
      }
      if (!input.evm.signMessageForAccount && !input.evm.signMessageAsync) {
        throw new Error("Wallet linking requires an active EVM signer");
      }
      const chainId = wallet.chainId ?? activeEvmChainId;
      if (!chainId) throw new Error("Wallet linking requires an EVM chain id");
      if (!account?.user || account.guest) {
        const accountId = wallet.accountId;
        const signMessageForAccount = input.evm.signMessageForAccount;
        await signInWithEvmWallet({
          accountClient,
          address: wallet.address as `0x${string}`,
          chainId,
          replaceGuestSession: account?.guest
            ? () => accountClient.signOut()
            : undefined,
          signMessage:
            accountId && signMessageForAccount
              ? (message) =>
                  signMessageForAccount({
                    accountId,
                    chainId,
                    message,
                  })
              : (message) =>
                  signMessageWithActiveEvm(input.evm.signMessageAsync, message),
          messageConfig: authMessageConfig,
        });
        await refresh();
        return;
      }
      const nonceResult = await accountClient.getWalletLinkNonce({
        address: wallet.address,
        chainId,
      });
      const message = buildWalletLinkMessage({
        address: wallet.address,
        chainId,
        nonce: nonceResult.nonce,
        ...messageConfigFromNonce(nonceResult, authMessageConfig),
      });
      const signature =
        wallet.accountId && input.evm.signMessageForAccount
          ? await input.evm.signMessageForAccount({
              accountId: wallet.accountId,
              chainId,
              message,
            })
          : await signMessageWithActiveEvm(input.evm.signMessageAsync, message);
      // Name the label after the wallet actually being linked, not whichever
      // wallet happens to be the active EVM signer — linking MetaMask while a
      // Privy smart wallet is active must read "MetaMask N", not "Privy …".
      const defaultLabel = buildDefaultWalletLabel({
        walletName: resolveLinkedWalletName({
          accounts: input.evm.accounts(Date.now()),
          accountId: wallet.accountId,
          address: wallet.address,
          fallbackWalletName: input.evm.activeEvmConnection?.walletName,
        }),
        existingWallets: account?.wallets ?? [],
        family: wallet.family,
      });
      const body = {
        ...wallet,
        chainId,
        label: defaultLabel,
        message,
        signature,
        nonce: nonceResult.nonce,
      };
      const result = await accountClient.linkWallet(body);
      if (result.account) setAccount(result.account);
      await refresh();
    },
    updateWallet: async ({ walletId, label }) => {
      await accountClient.updateWallet(walletId, { label });
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
  };
}

function walletAccountKey(family: WalletFamily, address: string): string {
  return family === "evm"
    ? `${family}:${address.toLowerCase()}`
    : `${family}:${address}`;
}

export function normalizeAccountWalletProvider(
  wallet: AccountWallet,
  liveAccounts: readonly Pick<
    AomiAccount,
    "family" | "address" | "provider" | "walletKind"
  >[],
): AccountWallet {
  const liveAccount = liveAccounts.find(
    (account) =>
      account.family === wallet.family &&
      walletAccountKey(account.family, account.address) ===
        walletAccountKey(wallet.family, wallet.address),
  );
  const provider = liveAccount?.provider;
  const walletKind = liveAccount?.walletKind;
  if (
    provider &&
    walletKind &&
    walletKind !== "embedded" &&
    walletKind !== "smart_account"
  ) {
    return wallet;
  }
  const inferredProvider =
    provider ?? providerLinkedWalletVia(wallet.linkedVia);
  if (!inferredProvider) return wallet;

  return {
    ...wallet,
    provider: wallet.provider ?? inferredProvider,
    kind:
      walletKind === "embedded" || walletKind === "smart_account"
        ? walletKind
        : (wallet.kind ?? "embedded"),
  };
}

function providerLinkedWalletVia(linkedVia: AccountWallet["linkedVia"]) {
  if (
    linkedVia === "siwe" ||
    linkedVia === "siws" ||
    linkedVia === "challenge" ||
    linkedVia === "import" ||
    linkedVia === "observed" ||
    linkedVia === "migration"
  ) {
    return null;
  }
  return linkedVia;
}

function credentialKey(credential: unknown): string {
  return (JSON.stringify(credential) ?? "").slice(0, 96);
}

function authCredentialKey(
  auth: Pick<AuthRuntime, "provider" | "subject">,
  key: string,
): string {
  return `${auth.provider}:${auth.subject ?? "unknown"}:${key}`;
}

function authSessionKey(
  auth: Pick<AuthRuntime, "provider" | "subject">,
): string {
  return `${auth.provider}:${auth.subject ?? "unknown"}`;
}

/**
 * Resolve the brand name of the wallet being linked from the live EVM accounts,
 * matching by stable account id first and address second. Falls back to the
 * caller-supplied active-connection name only when the linked wallet isn't in
 * the live set — so a default label is always brand-correct for the wallet the
 * user actually picked, even when a different wallet is the active signer.
 */
export function resolveLinkedWalletName(input: {
  accounts: ReadonlyArray<{
    id: string;
    address?: string;
    walletName?: string;
  }>;
  accountId?: string;
  address: string;
  fallbackWalletName?: string;
}): string | undefined {
  const target = input.address.toLowerCase();
  const match = input.accounts.find(
    (candidate) =>
      (input.accountId !== undefined && candidate.id === input.accountId) ||
      candidate.address?.toLowerCase() === target,
  );
  return match?.walletName ?? input.fallbackWalletName;
}

/**
 * Build a first-link default label like "Rabby 1" / "MetaMask 2" so the
 * account-management row is never blank before the user renames it. Only used
 * as the initial value — the account service persists labels as
 * `auth_providers.provider_metadata.display_label` and keeps the stored one on
 * re-link, so user renames stick.
 */
export function buildDefaultWalletLabel(input: {
  walletName?: string | null;
  existingWallets: readonly AccountWallet[];
  family: WalletFamily;
}): string {
  const brand = brandDisplayName(input.walletName);
  const sameBrand = input.existingWallets.filter(
    (wallet) =>
      wallet.family === input.family &&
      wallet.label?.toLowerCase().startsWith(brand.toLowerCase()),
  ).length;
  return `${brand} ${sameBrand + 1}`;
}

async function signMessageWithActiveEvm(
  signMessageAsync: EvmWalletRuntime["signMessageAsync"],
  message: string,
): Promise<`0x${string}`> {
  if (!signMessageAsync) {
    throw new Error("Wallet linking requires an active EVM signer");
  }
  return (await (
    signMessageAsync as (args: { message: string }) => Promise<`0x${string}`>
  )({ message })) as `0x${string}`;
}

async function signInWithEvmWallet(input: {
  accountClient: ReturnType<typeof createAomiBackendAccountClient>;
  address: `0x${string}`;
  chainId: number;
  signMessage: (message: string) => Promise<`0x${string}`>;
  messageConfig: AuthMessageConfig;
  replaceGuestSession?: () => Promise<void>;
}): Promise<void> {
  // A wallet may already own a durable account, so replace the disposable
  // guest before issuing a sign-in challenge instead of linking the two.
  await input.replaceGuestSession?.();
  const nonceResult = await input.accountClient.createSiweNonce();
  const message = buildSiweMessage({
    address: input.address,
    chainId: input.chainId,
    nonce: nonceResult.nonce,
    ...messageConfigFromNonce(nonceResult, input.messageConfig),
  });
  const signature = await input.signMessage(message);
  await input.accountClient.verifySiwe({
    message,
    signature,
  });
}

async function signMessageWithActiveSvm(
  signMessage: NonNullable<SvmWalletRuntime["execution"]["signSolanaMessage"]>,
  message: string,
  chainId: SvmCluster,
): Promise<string> {
  const result = await signMessage({
    message: utf8ToBase64(message),
    cluster: chainId,
    description: "Authorize this Solana wallet for your Aomi account.",
  });
  return result.signature;
}

async function authenticateSvmWallet(input: {
  accountClient: ReturnType<typeof createAomiBackendAccountClient>;
  address: string;
  chainId: SvmCluster;
  intent: "sign-in" | "link";
  label?: string;
  signMessage: (message: string) => Promise<string>;
  messageConfig: AuthMessageConfig;
  replaceGuestSession?: () => Promise<void>;
}): Promise<void> {
  await input.replaceGuestSession?.();
  const nonceResult = await input.accountClient.createSiwsNonce({
    walletAddress: input.address,
    chainId: input.chainId,
    intent: input.intent,
  });
  const message = buildSiwsMessage({
    address: input.address,
    chainId: input.chainId,
    nonce: nonceResult.nonce,
    intent: input.intent,
    ...messageConfigFromNonce(nonceResult, input.messageConfig),
  });
  const signature = await input.signMessage(message);
  await input.accountClient.verifySiws({
    message,
    signature,
    walletAddress: input.address,
    chainId: input.chainId,
    intent: input.intent,
    label: input.label,
  });
}

export type AuthMessageConfig = {
  domain: string;
  uri: string;
};

export function resolveAuthMessageConfig(input: {
  baseUrl?: string;
  authDomain?: string;
  authUri?: string;
}): AuthMessageConfig {
  const base = absoluteUrl(input.baseUrl);
  const fallbackOrigin =
    base?.origin ??
    (typeof window !== "undefined" ? window.location.origin : "");
  const fallbackDomain =
    base?.host ?? (typeof window !== "undefined" ? window.location.host : "");
  return {
    domain: normalizeDomain(input.authDomain) ?? fallbackDomain,
    uri: normalizeUri(input.authUri) ?? fallbackOrigin,
  };
}

export function buildSiweMessage(input: {
  address: string;
  chainId: number;
  nonce: string;
  domain: string;
  uri: string;
}): string {
  const { domain, uri } = requireAuthMessageConfig(input);
  return `${domain} wants you to sign in with your Ethereum account:
${input.address}

Sign in to Aomi.

URI: ${uri}
Version: 1
Chain ID: ${input.chainId}
Nonce: ${input.nonce}
Issued At: ${new Date().toISOString()}`;
}

export function buildWalletLinkMessage(input: {
  address: string;
  chainId: number;
  nonce: string;
  domain: string;
  uri: string;
}): string {
  const { domain, uri } = requireAuthMessageConfig(input);
  return `${domain} wants to link this wallet to your Aomi account:
${input.address}

Only sign this message if you want this wallet attached to the current Aomi account.

URI: ${uri}
Version: 1
Chain ID: ${input.chainId}
Nonce: ${input.nonce}
Issued At: ${new Date().toISOString()}`;
}

function messageConfigFromNonce(
  nonce: AomiBackendNonceResponse,
  fallback: AuthMessageConfig,
): AuthMessageConfig {
  return completeAuthMessageConfig({
    domain: normalizeDomain(nonce.domain) ?? normalizeDomain(fallback.domain),
    uri: normalizeUri(nonce.uri) ?? normalizeUri(fallback.uri),
  });
}

function browserAuthMessageConfig(): AuthMessageConfig {
  if (typeof window === "undefined") {
    return { domain: "", uri: "" };
  }
  return {
    domain: window.location.host,
    uri: window.location.origin,
  };
}

function requireAuthMessageConfig(input: AuthMessageConfig): AuthMessageConfig {
  return completeAuthMessageConfig(input);
}

function completeAuthMessageConfig(
  input: Partial<AuthMessageConfig>,
): AuthMessageConfig {
  const browserFallback = browserAuthMessageConfig();
  const uri =
    normalizeUri(input.uri) ??
    normalizeUri(browserFallback.uri) ??
    deriveUriFromDomain(input.domain) ??
    "http://localhost";
  const domain =
    normalizeDomain(input.domain) ??
    normalizeDomain(uri) ??
    normalizeDomain(browserFallback.domain) ??
    "localhost";
  return { domain, uri };
}

function hasAuthMessageConfig(input: Partial<AuthMessageConfig>): boolean {
  const browserFallback = browserAuthMessageConfig();
  const domain =
    normalizeDomain(input.domain) ?? normalizeDomain(browserFallback.domain);
  const uri =
    normalizeUri(input.uri) ??
    normalizeUri(browserFallback.uri) ??
    deriveUriFromDomain(domain);
  return Boolean(domain && uri);
}

function absoluteUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function normalizeDomain(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  try {
    const host = new URL(trimmed).host.trim();
    if (host) return host;
  } catch {
    // Fall through to authority parsing below.
  }
  return (
    trimmed
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
      .replace(/\/.*$/, "")
      .trim() || undefined
  );
}

function normalizeUri(value: string | undefined): string | undefined {
  const trimmed = value?.trim().replace(/\/+$/, "");
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

function deriveUriFromDomain(value: string | undefined): string | undefined {
  const domain = normalizeDomain(value);
  if (!domain) return undefined;
  return domain.includes("localhost") || domain.startsWith("127.")
    ? `http://${domain}`
    : `https://${domain}`;
}
