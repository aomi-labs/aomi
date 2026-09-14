"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrivy, useSignTypedData } from "@privy-io/react-auth";
import type { SignTypedDataParams } from "@privy-io/react-auth";
import {
  authorizationChallenge,
  authorizationCommit,
  type AccountSessionProvider,
  type AuthorizationPoster,
} from "@aomi-labs/client";

import { aomiBffUrl } from "@/app/config";
import { embeddedWallet } from "@/lib/privy-wallet";
import type { LaunchContext } from "@/lib/telegram";

export type PermissionStatus = "idle" | "ready" | "signing" | "done" | "error";

export type PermissionTarget = {
  chain: string;
  wallet: string;
  mode: string;
  /** True when the bot named the key; false when we defaulted to the user's. */
  fromLaunch: boolean;
};

/** The backend emits a standard EIP-712 JSON document, which is exactly the
 *  shape Privy's `signTypedData` takes — but the client types it as `unknown`,
 *  so narrow it rather than asserting. */
function asTypedData(value: unknown): SignTypedDataParams | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SignTypedDataParams>;
  if (
    typeof candidate.primaryType !== "string" ||
    !candidate.types ||
    typeof candidate.types !== "object" ||
    !candidate.domain ||
    typeof candidate.domain !== "object" ||
    !candidate.message ||
    typeof candidate.message !== "object"
  ) {
    return null;
  }
  return candidate as SignTypedDataParams;
}

export function usePermissionControl(input: {
  launch: LaunchContext | null;
  provider: AccountSessionProvider | null;
  /** The exact embedded wallet is already armed in the backend. */
  serverAuto?: boolean;
}) {
  const [status, setStatus] = useState<PermissionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  // A restored `serverAuto` state is complete, but this particular page did
  // not perform a signing action. Keep that distinction so reopening /wallet
  // remains visible instead of immediately closing the Mini App.
  const [signedHere, setSignedHere] = useState(false);
  // Signing a permit puts a wallet prompt between the challenge and the commit.
  // Holding the provider in a ref means the commit uses whatever session is
  // current when it runs, instead of an instance that was disposed while the
  // prompt was on screen — the failure mode where the backend logs an
  // `authorization/challenge` 200 that no `authorization/commit` ever follows.
  const providerRef = useRef(input.provider);
  useEffect(() => {
    providerRef.current = input.provider;
  }, [input.provider]);

  const { user } = usePrivy();
  const { signTypedData } = useSignTypedData();
  // Read off the Privy *user*, never `useWallets()`: that hook's `ready` waits
  // on a wallet-proxy iframe that Telegram's webview routinely blocks, so it
  // would leave the sign button permanently unrendered on an account whose
  // wallet exists and works. See `lib/privy-wallet.ts`.
  const wallet = useMemo(() => embeddedWallet(user), [user]);

  const target = useMemo((): PermissionTarget | null => {
    const launch = input.launch;
    if (
      launch?.permissionChain &&
      launch.permissionWallet &&
      launch.permissionMode
    ) {
      return {
        chain: launch.permissionChain,
        wallet: launch.permissionWallet,
        mode: launch.permissionMode,
        fromLaunch: true,
      };
    }
    // Launched from `/wallet` rather than `/permission`: the bot named no key,
    // but the user's own embedded wallet is a valid target — it is already
    // bound by the exchange, its provider supports delegated signing, and the
    // permit's signer is the wallet itself, which is what the loosen rule
    // requires. Arming it is the whole point of opening this page.
    if (!wallet) return null;
    return {
      chain: "evm",
      wallet: wallet.address,
      mode: "server_auto",
      fromLaunch: false,
    };
  }, [input.launch, wallet]);

  const sign = useCallback(async () => {
    if (!target || !wallet) return;
    setStatus("signing");
    setError(null);
    try {
      const post: AuthorizationPoster = async (path, body) => {
        const provider = providerRef.current;
        if (!provider) throw new Error("permission_session_unavailable");
        const token = await provider();
        const response = await fetch(new URL(path, aomiBffUrl), {
          method: "POST",
          credentials: "omit",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(
            typeof payload?.error === "string"
              ? payload.error
              : `permission_failed_${response.status}`,
          );
        }
        return payload;
      };
      const challenge = await authorizationChallenge(post, {
        chain_type: target.chain,
        wallet: target.wallet,
        mode: target.mode,
      });
      const typedData = asTypedData(challenge.typed_data);
      if (!typedData) {
        throw new Error("permission_challenge_invalid_typed_data");
      }
      // Signed through Privy's own headless path, which takes the wallet by
      // address. The permit's EIP-712 domain carries only name and version —
      // no chainId, no verifying contract — so there is no chain to select.
      const { signature } = await signTypedData(typedData, {
        address: wallet.address,
      });
      await authorizationCommit(post, { permit: challenge.permit, signature });
      setStatus("done");
      setSignedHere(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "permission_failed");
      setStatus("error");
    }
  }, [signTypedData, target, wallet]);

  return {
    error,
    sign,
    signedHere,
    status:
      status !== "idle"
        ? status
        : input.serverAuto && !target?.fromLaunch
          ? "done"
          : target && input.provider && wallet
            ? ("ready" as const)
            : status,
    target,
  };
}
