"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  authorizationChallenge,
  authorizationCommit,
  type AuthorizationPoster,
  type WalletEip712Payload,
} from "@aomi-labs/client";
import { useOptionalAomiRuntime } from "@aomi-labs/react";
import {
  type AomiWalletKit,
  useAomiWalletKit,
  usePrivyDelegation,
} from "@aomi-labs/widget-lib";
import { accountScopedFetch } from "@portal/lib/settings-api";
import {
  explainAccountError,
  fetchAccountAcl,
  revokeProviderDelegation,
} from "./account-api";
import { bindWalletVia } from "./wallet-bind";
import type { DelegatedAccountView, SignerMode, WalletPolicy } from "./types";

const post: AuthorizationPoster = (path, body) =>
  accountScopedFetch(path, { method: "POST", body: JSON.stringify(body) });

/** Run `action`, restating any failure in words the user can act on. */
async function readable<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (cause) {
    throw new Error(explainAccountError(cause));
  }
}

/**
 * Permit direction, mirroring the kernel's `SigningMode` rank ladder. The
 * backend decides *whose signature counts* from this: loosening authority
 * requires the wallet itself to sign, tightening accepts any key linked to the
 * account. We compute it client-side only to explain the requirement up front
 * rather than after a rejected signature.
 */
const MODE_RANK: Record<SignerMode, number> = {
  denied: 0,
  manual: 1,
  client_auto: 2,
  auto: 3,
};

export function isLoosening(from: SignerMode, to: SignerMode): boolean {
  return MODE_RANK[to] > MODE_RANK[from];
}

export type AclStatus = "loading" | "ready" | "error";

export type UnboundWallet = {
  id: string;
  chain: "evm" | "svm";
  address: string;
  walletName?: string;
  provider?: string;
  active: boolean;
};

export type AccountAcl = {
  status: AclStatus;
  error?: string;
  wallets: WalletPolicy[];
  delegatedAccounts: DelegatedAccountView[];
  /** Connected adapter accounts not yet linked via the bind ceremony. */
  unboundWallets: UnboundWallet[];
  refresh: () => Promise<void>;
  /** Run the permit ceremony; resolves once the new mode is committed. */
  commitMode: (wallet: WalletPolicy, mode: SignerMode) => Promise<void>;
  /** Link a connected wallet to the account (bind ceremony). */
  bindWallet: (wallet: UnboundWallet) => Promise<"bound" | "already_bound">;
  revokeDelegation: (delegation: DelegatedAccountView) => Promise<void>;
  stopAllAuto: () => Promise<void>;
  canConnectPrivy: boolean;
  connectPrivy: () => Promise<void>;
  /** Re-open the provider so a fresh delegation can be established. */
  renewDelegation: (wallet: WalletPolicy) => Promise<void>;
  /** Why this wallet can't sign the given change right now, or null if it can. */
  blockedReason: (wallet: WalletPolicy, mode: SignerMode) => string | null;
};

type AdapterAccount = AomiWalletKit["accounts"][number];

function unboundFromAccounts(
  accounts: readonly AdapterAccount[],
  wallets: WalletPolicy[],
): UnboundWallet[] {
  const bound = new Set(
    wallets.map((wallet) => `${wallet.chain}:${wallet.address.toLowerCase()}`),
  );
  return accounts
    .filter((account) => account.address)
    .filter((account) => {
      const chain = account.family;
      return !bound.has(`${chain}:${account.address.toLowerCase()}`);
    })
    .map((account) => ({
      id: `${account.family}:${account.address}`,
      chain: account.family,
      address: account.address,
      walletName: account.walletName,
      provider: account.provider,
      active: account.active,
    }));
}

export function useAccountAcl(): AccountAcl {
  const adapter = useAomiWalletKit();
  const runtime = useOptionalAomiRuntime();
  const privyDelegation = usePrivyDelegation();
  const [wallets, setWallets] = useState<WalletPolicy[]>([]);
  const [delegatedAccounts, setDelegatedAccounts] = useState<
    DelegatedAccountView[]
  >([]);
  const [status, setStatus] = useState<AclStatus>("loading");
  const [error, setError] = useState<string | undefined>();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const evmAddress = adapter.identity.address;
  const svmAddress = adapter.identity.svmAddress;
  const svmCluster = adapter.identity.svmCluster;
  const signTypedData = adapter.signTypedData;
  const signSolanaMessage = adapter.signSolanaMessage;
  const openAccountUI = adapter.openAccountUI;
  const currentThreadId = runtime?.currentThreadId;
  const canConnectPrivy =
    adapter.identity.sessionProvider === "privy" ||
    adapter.identity.embeddedProvider === "privy";
  const unboundWallets = useMemo(
    () => unboundFromAccounts(adapter.accounts ?? [], wallets),
    [adapter.accounts, wallets],
  );

  const refresh = useCallback(async () => {
    try {
      const account = await fetchAccountAcl();
      if (!mounted.current) return;
      setWallets(account.wallets);
      setDelegatedAccounts(account.delegatedAccounts);
      setStatus("ready");
      setError(undefined);
    } catch (cause) {
      if (!mounted.current) return;
      setStatus("error");
      setError(explainAccountError(cause));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signerFor = useCallback(
    (wallet: WalletPolicy) =>
      wallet.chain === "evm"
        ? { address: evmAddress, canSign: Boolean(signTypedData && evmAddress) }
        : {
            address: svmAddress,
            canSign: Boolean(signSolanaMessage && svmAddress),
          },
    [evmAddress, svmAddress, signSolanaMessage, signTypedData],
  );

  const blockedReason = useCallback(
    (wallet: WalletPolicy, mode: SignerMode): string | null => {
      if (mode === "auto" && wallet.canUseAuto === false) {
        return "This wallet has no active delegated account to sign with.";
      }
      const signer = signerFor(wallet);
      const chainLabel = wallet.chain === "evm" ? "Ethereum" : "Solana";
      if (!signer.canSign) {
        return `Connect a ${chainLabel} wallet to sign this authorization.`;
      }
      const needsSelf =
        isLoosening(wallet.desiredMode, mode) && !wallet.providerManaged;
      if (
        needsSelf &&
        signer.address?.toLowerCase() !== wallet.address.toLowerCase()
      ) {
        return "Connect this wallet itself to widen what it may sign.";
      }
      return null;
    },
    [signerFor],
  );

  const commitMode = useCallback(
    async (wallet: WalletPolicy, mode: SignerMode) => {
      const blocked = blockedReason(wallet, mode);
      if (blocked) throw new Error(blocked);

      const challenge = await readable(() =>
        authorizationChallenge(post, {
          chain_type: wallet.chain,
          wallet: wallet.address,
          // The view's "auto" rung is `server_auto` on the wire (the kernel's
          // canonical spelling; the permit echoes it back through commit).
          mode: mode === "auto" ? "server_auto" : mode,
        }),
      );

      if (wallet.chain === "evm") {
        if (!challenge.typed_data || !signTypedData) {
          throw new Error("This wallet cannot sign EIP-712 authorizations.");
        }
        const { signature } = await readable(() =>
          signTypedData({
            typed_data:
              challenge.typed_data as WalletEip712Payload["typed_data"],
            description: permitDescription(wallet, mode),
          }),
        );
        await readable(() =>
          authorizationCommit(post, { permit: challenge.permit, signature }),
        );
      } else {
        if (!challenge.message_base64 || !signSolanaMessage) {
          throw new Error("This wallet cannot sign Solana authorizations.");
        }
        const { signature } = await readable(() =>
          signSolanaMessage({
            message: challenge.message_base64 as string,
            cluster: svmCluster,
            description: permitDescription(wallet, mode),
          }),
        );
        await readable(() =>
          authorizationCommit(post, {
            permit: challenge.permit,
            signature,
            ...(svmAddress ? { signer: svmAddress } : {}),
          }),
        );
      }

      await refresh();
    },
    [
      blockedReason,
      refresh,
      signSolanaMessage,
      signTypedData,
      svmAddress,
      svmCluster,
    ],
  );

  const bindWallet = useCallback(
    async (wallet: UnboundWallet) => {
      const result = await readable(() =>
        bindWalletVia(post, {
          chain: wallet.chain,
          address: wallet.address,
          signTypedData,
          signSolanaMessage,
          svmCluster,
          signerAddress: wallet.chain === "svm" ? svmAddress : evmAddress,
        }),
      );
      await refresh();
      return result;
    },
    [
      evmAddress,
      refresh,
      signSolanaMessage,
      signTypedData,
      svmAddress,
      svmCluster,
    ],
  );

  const revokeDelegation = useCallback(
    async (delegation: DelegatedAccountView) => {
      const providerKey =
        delegation.providerKey ?? delegation.provider.toLowerCase();
      await readable(() => revokeProviderDelegation(providerKey));
      await refresh();
    },
    [refresh],
  );

  const stopAllAuto = useCallback(async () => {
    const providers = new Set(
      delegatedAccounts
        .filter((delegation) => delegation.status === "active")
        .map(
          (delegation) =>
            delegation.providerKey ?? delegation.provider.toLowerCase(),
        ),
    );
    for (const provider of providers) {
      await readable(() => revokeProviderDelegation(provider));
    }
    await refresh();
  }, [delegatedAccounts, refresh]);

  const connectPrivy = useCallback(async () => {
    if (!currentThreadId) {
      throw new Error("Open a chat thread before enabling automatic signing.");
    }
    const response = await fetch("/api/delegation/privy/begin", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Thread-Id": currentThreadId,
      },
      // Linking a Privy wallet is intentionally the safe default. Auto must
      // cross the separate delegated-signing consent boundary explicitly.
      body: JSON.stringify({
        wallet_family: "evm",
        purpose: "delegate_signing",
      }),
      credentials: "include",
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => null)) as {
      auth_url?: unknown;
      state_token?: unknown;
    } | null;
    if (
      !response.ok ||
      typeof payload?.auth_url !== "string" ||
      typeof payload.state_token !== "string"
    ) {
      throw new Error("Could not start Privy automatic signing setup.");
    }
    const signerId = new URL(payload.auth_url).searchParams
      .get("signer_id")
      ?.trim();
    if (!signerId) {
      throw new Error("Aomi's Privy signer is not configured.");
    }
    await privyDelegation.start({ state: payload.state_token, signerId });
    await refresh();
  }, [currentThreadId, privyDelegation, refresh]);

  const renewDelegation = useCallback(
    async (wallet: WalletPolicy) => {
      if (
        wallet.chain === "evm" &&
        wallet.provider?.toLowerCase() === "privy"
      ) {
        await connectPrivy();
        return;
      }
      if (!openAccountUI) {
        throw new Error(
          "Reconnect this provider from the wallet menu to establish a new delegation.",
        );
      }
      await openAccountUI({ family: wallet.chain });
      await refresh();
    },
    [connectPrivy, openAccountUI, refresh],
  );

  return useMemo(
    () => ({
      status,
      error,
      wallets,
      delegatedAccounts,
      unboundWallets,
      refresh,
      commitMode,
      bindWallet,
      revokeDelegation,
      stopAllAuto,
      canConnectPrivy,
      connectPrivy,
      renewDelegation,
      blockedReason,
    }),
    [
      bindWallet,
      blockedReason,
      canConnectPrivy,
      commitMode,
      connectPrivy,
      error,
      delegatedAccounts,
      refresh,
      renewDelegation,
      revokeDelegation,
      status,
      stopAllAuto,
      unboundWallets,
      wallets,
    ],
  );
}

function permitDescription(wallet: WalletPolicy, mode: SignerMode): string {
  return `Authorize "${mode}" signing for ${wallet.address} on your Aomi account.`;
}
