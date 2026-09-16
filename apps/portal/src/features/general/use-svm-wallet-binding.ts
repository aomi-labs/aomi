"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ensureSvmWalletBoundVia,
  type AuthorizationPoster,
} from "@aomi-labs/client";
import { useAomiWalletKit } from "@aomi-labs/widget-lib";
import { accountScopedFetch } from "@portal/lib/settings-api";

type SigningPolicy = {
  address: { chain: "evm" | "svm"; address: string };
  mode: string;
};

export type SvmBindingState =
  | { status: "no-wallet" }
  | { status: "loading" }
  | { status: "unbound" }
  | { status: "bound"; signingMode: string }
  | { status: "error"; message: string };

const DESCRIPTION =
  "Bind this Solana wallet to your Aomi account so it can sign transactions.";

const post: AuthorizationPoster = (path, body) =>
  accountScopedFetch(path, {
    method: "POST",
    body: JSON.stringify(body),
  });

export function useSvmWalletBinding() {
  const adapter = useAomiWalletKit();
  const svmAddress = adapter.identity.svmAddress;
  const cluster = adapter.identity.svmCluster;
  const capabilities = adapter.identity.svmCapabilities;
  const signSolanaMessage = adapter.signSolanaMessage;
  const requiresBinding =
    adapter.identity.svmTransport === "embedded";
  const [state, setState] = useState<SvmBindingState>({ status: "no-wallet" });
  const [binding, setBinding] = useState(false);

  const refresh = useCallback(async () => {
    if (!svmAddress) {
      setState({ status: "no-wallet" });
      return;
    }
    setState({ status: "loading" });
    try {
      const data = await accountScopedFetch<{
        signing_policies: SigningPolicy[];
      }>("/api/account");
      const row = data.signing_policies.find(
        (policy) =>
          policy.address.chain === "svm" &&
          policy.address.address === svmAddress,
      );
      setState(
        row
          ? { status: "bound", signingMode: row.mode }
          : { status: "unbound" },
      );
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Failed to load",
      });
    }
  }, [svmAddress]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const bind = useCallback(async (): Promise<boolean> => {
    if (!requiresBinding || !svmAddress || !signSolanaMessage) return false;
    setBinding(true);
    try {
      await ensureSvmWalletBoundVia(post, svmAddress, async (message) => {
        const result = await signSolanaMessage({
          message: bytesToBase64(message),
          cluster,
          description: DESCRIPTION,
        });
        return base64ToBytes(result.signature);
      });
      await refresh();
      return true;
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Bind failed",
      });
      return false;
    } finally {
      setBinding(false);
    }
  }, [cluster, refresh, signSolanaMessage, svmAddress, requiresBinding]);

  return {
    state,
    binding,
    requiresBinding,
    canBind: Boolean(
      requiresBinding &&
      svmAddress &&
      signSolanaMessage &&
      (capabilities?.canSignMessage ?? true),
    ),
    bind,
    refresh,
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}
