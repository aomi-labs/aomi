"use client";

import { useCallback, useMemo } from "react";
import {
  authorizationChallenge,
  authorizationCommit,
  UserState,
  type AuthorizationPoster,
  type AomiAuthorizationChallenge,
  type WalletEip712Payload,
} from "@aomi-labs/client";
import {
  fetchDisplayQuery,
  useAomiDisplayCache,
  useDisplayQuery,
  type DisplayCache,
  type DisplayQuery,
} from "@aomi-labs/react";
import { useAomiWalletKit } from "../wallet/context";
import { useShellTransport, type ShellRequest } from "./transport";
import { accountProfileQuery } from "./account-overview";
import {
  explainAccountError,
  fetchAccountAcl,
  provisionProviderAgentWallet,
} from "./account-api";
import type { SignerChoice, SignerMode, WalletPolicy } from "./types";

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
  auto: 2,
};

export function isLoosening(from: SignerMode, to: SignerMode): boolean {
  return MODE_RANK[to] > MODE_RANK[from];
}

export type AclStatus = "loading" | "ready" | "error";

/** Wallet policies, derived from the same /api/account read as the profile. */
export function accountAclQuery(
  request: ShellRequest,
  cache: DisplayCache | null,
): DisplayQuery<Awaited<ReturnType<typeof fetchAccountAcl>>> {
  const account = cache?.scope.account;
  const profile = accountProfileQuery(
    request,
    account?.kind === "user" ? account.id : undefined,
  );
  return {
    resource: "account-acl",
    fetcher: (signal) =>
      fetchAccountAcl(
        <T>(path: string, options?: RequestInit) =>
          (path === "/api/account" && cache
            ? fetchDisplayQuery(cache, profile)
            : request(path, { ...options, signal })) as Promise<T>,
        signal,
      ),
  };
}

export type AccountAcl = {
  status: AclStatus;
  error?: string;
  wallets: WalletPolicy[];
  refresh: () => Promise<void>;
  /** Fetch the unsigned permit for review, without invoking a signer. */
  prepareMode: (
    wallet: WalletPolicy,
    mode: SignerChoice,
  ) => Promise<AomiAuthorizationChallenge>;
  /** Sign the reviewed permit; resolves once the new mode is committed. */
  commitMode: (
    wallet: WalletPolicy,
    mode: SignerChoice,
    challenge: AomiAuthorizationChallenge,
  ) => Promise<void>;
  /** Provision the provider's server-side agent wallet for one chain. */
  createAgentWallet: (chain: "evm" | "svm") => Promise<void>;
  /** Why this wallet can't sign the given change right now, or null if it can. */
  blockedReason: (wallet: WalletPolicy, mode: SignerChoice) => string | null;
};

export function useAccountAcl(): AccountAcl {
  const transport = useShellTransport();
  const request = transport.json;
  const post: AuthorizationPoster = useCallback(
    (path, body) =>
      request(path, { method: "POST", body: JSON.stringify(body) }),
    [request],
  );
  const adapter = useAomiWalletKit();
  const cache = useAomiDisplayCache();
  const query = useDisplayQuery(accountAclQuery(request, cache));
  const wallets = query.data?.wallets ?? [];
  const status: AclStatus = query.isPending
    ? "loading"
    : query.error
      ? "error"
      : "ready";
  const error = query.error ? explainAccountError(query.error) : undefined;
  const evmAddress = adapter.identity.address;
  const svmAddress = adapter.identity.svmAddress;
  const svmCluster = adapter.identity.svmCluster;
  const signTypedData = adapter.signTypedData;
  const signSolanaMessage = adapter.signSolanaMessage;

  const refresh = useCallback(async () => {
    if (cache)
      await cache.client.invalidateQueries({
        queryKey: cache.key("profile"),
        exact: true,
        refetchType: "none",
      });
    await query.refetch();
  }, [cache, query.refetch]);

  const signerFor = useCallback(
    (wallet: Pick<WalletPolicy, "chain" | "address" | "providerManaged">) => {
      const address = wallet.chain === "evm" ? evmAddress : svmAddress;
      const sameOperatingWallet = Boolean(
        address &&
        UserState.sameAddress(
          { chain: wallet.chain, address },
          { chain: wallet.chain, address: wallet.address },
        ),
      );
      // A provider-managed agent wallet holds no user key, so it can never be
      // the connected wallet. The backend arms it on a permit signed by the
      // user's own key from the same provider (the Para login wallet), so the
      // connected same-chain wallet is the signer there.
      const signerMatches = wallet.providerManaged
        ? Boolean(address)
        : sameOperatingWallet;
      const hasSigningMethod =
        wallet.chain === "evm"
          ? Boolean(signTypedData)
          : Boolean(signSolanaMessage);
      return {
        address,
        canSign: Boolean(signerMatches && hasSigningMethod && address),
      };
    },
    [evmAddress, svmAddress, signSolanaMessage, signTypedData],
  );

  const blockedReason = useCallback(
    (wallet: WalletPolicy, mode: SignerChoice): string | null => {
      const signer = signerFor(wallet);
      const chainLabel = wallet.chain === "evm" ? "Ethereum" : "Solana";
      if (!signer.canSign) {
        return `Connect a ${chainLabel} wallet to sign this authorization.`;
      }
      const needsSelf =
        isLoosening(wallet.desiredMode, mode) && !wallet.providerManaged;
      if (
        needsSelf &&
        !UserState.sameAddress(
          { chain: wallet.chain, address: signer.address ?? "" },
          { chain: wallet.chain, address: wallet.address },
        )
      ) {
        return "Connect this wallet itself to widen what it may sign.";
      }
      return null;
    },
    [signerFor],
  );

  const prepareMode = useCallback(
    async (wallet: WalletPolicy, mode: SignerChoice) => {
      const blocked = blockedReason(wallet, mode);
      if (blocked) throw new Error(blocked);

      const challenge = await readable(() =>
        authorizationChallenge(post, {
          chain_type: wallet.chain,
          wallet: wallet.address,
          mode,
        }),
      );
      if (
        wallet.chain === "evm"
          ? !challenge.typed_data
          : !challenge.message_base64
      ) {
        throw new Error(
          "The authorization payload is missing. Review this change again.",
        );
      }
      return challenge;
    },
    [blockedReason],
  );

  const commitMode = useCallback(
    async (
      wallet: WalletPolicy,
      mode: SignerChoice,
      challenge: AomiAuthorizationChallenge,
    ) => {
      const blocked = blockedReason(wallet, mode);
      if (blocked) throw new Error(blocked);
      const signer = signerFor(wallet);

      if (challenge.permit.expiry <= Math.floor(Date.now() / 1000)) {
        throw new Error(
          "This authorization expired. Review the change again before signing.",
        );
      }

      if (wallet.chain === "evm") {
        if (!challenge.typed_data || !signTypedData) {
          throw new Error("This wallet cannot sign EIP-712 authorizations.");
        }
        const { signature } = await readable(() =>
          signTypedData({
            signer: signer.address,
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
            signer: signer.address,
            message: challenge.message_base64 as string,
            cluster: svmCluster,
            description: permitDescription(wallet, mode),
          }),
        );
        await readable(() =>
          authorizationCommit(post, {
            permit: challenge.permit,
            signature,
            signer: signer.address,
          }),
        );
      }

      await refresh();
    },
    [
      blockedReason,
      signerFor,
      refresh,
      signSolanaMessage,
      signTypedData,
      svmCluster,
    ],
  );

  const createAgentWallet = useCallback(
    async (chain: "evm" | "svm") => {
      await readable(() =>
        provisionProviderAgentWallet("para", chain, request),
      );
      await refresh();
    },
    [refresh],
  );

  return useMemo(
    () => ({
      status,
      error,
      wallets,
      refresh,
      prepareMode,
      commitMode,
      createAgentWallet,
      blockedReason,
    }),
    [
      blockedReason,
      prepareMode,
      commitMode,
      createAgentWallet,
      error,
      refresh,
      status,
      wallets,
    ],
  );
}

function permitDescription(wallet: WalletPolicy, mode: SignerChoice): string {
  return `Authorize "${mode}" signing for ${wallet.address} on your Aomi account.`;
}
