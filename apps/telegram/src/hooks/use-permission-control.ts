"use client";

import { useCallback, useMemo, useState } from "react";
import { createParaViemClientHook } from "@getpara/react-core/evm/viem";
import {
  authorizationChallenge,
  authorizationCommit,
  toViemSignTypedDataArgs,
  type AccountSessionProvider,
  type AuthorizationPoster,
} from "@aomi-labs/client";
import { http } from "viem";
import { mainnet } from "viem/chains";

import { aomiBffUrl } from "@/app/config";
import type { LaunchContext } from "@/lib/telegram";

const useEmbeddedParaViemClient = createParaViemClientHook();

export function usePermissionControl(input: {
  launch: LaunchContext | null;
  provider: AccountSessionProvider | null;
}) {
  const [status, setStatus] = useState<
    "idle" | "ready" | "signing" | "done" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const { viemClient } = useEmbeddedParaViemClient({
    walletClientConfig: {
      chain: mainnet,
      transport: http(mainnet.rpcUrls.default.http[0]),
    },
  });
  const target = useMemo(() => {
    const launch = input.launch;
    if (
      !launch?.permissionChain ||
      !launch.permissionWallet ||
      !launch.permissionMode
    ) {
      return null;
    }
    return {
      chain: launch.permissionChain,
      wallet: launch.permissionWallet,
      mode: launch.permissionMode,
    };
  }, [input.launch]);

  const sign = useCallback(async () => {
    if (!target || !input.provider || !viemClient?.account) return;
    setStatus("signing");
    setError(null);
    try {
      const post: AuthorizationPoster = async (path, body) => {
        const token = await input.provider!();
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
      if (!challenge.typed_data) {
        throw new Error("permission_challenge_missing_typed_data");
      }
      const request = toViemSignTypedDataArgs({
        typed_data: challenge.typed_data,
      });
      if (!request?.message) {
        throw new Error("permission_challenge_invalid_typed_data");
      }
      const { message, ...rest } = request;
      const signature = await viemClient.signTypedData({
        account: viemClient.account,
        ...rest,
        message,
      });
      await authorizationCommit(post, { permit: challenge.permit, signature });
      setStatus("done");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "permission_failed");
      setStatus("error");
    }
  }, [input.provider, target, viemClient]);

  return {
    error,
    sign,
    status:
      status === "idle" && target && input.provider && viemClient?.account
        ? "ready"
        : status,
    target,
  };
}
