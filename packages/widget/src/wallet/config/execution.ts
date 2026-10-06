"use client";

import type { ExecutionConfig } from "./types";
import type { NativeWalletExecutionPolicy } from "../execution/wallet-execution";

type EnabledSponsorship = Extract<
  NonNullable<ExecutionConfig["sponsorship"]>,
  { mode: "optional" | "required" }
>;

function isEnabledSponsorship(
  sponsorship: ExecutionConfig["sponsorship"],
): sponsorship is EnabledSponsorship {
  return sponsorship?.mode === "optional" || sponsorship?.mode === "required";
}

function resolveMaybeFunction<T>(
  value: T | ((chainId: number) => T | undefined) | undefined,
): ((chainId: number) => T | undefined) | undefined {
  if (typeof value === "function") {
    return value as (chainId: number) => T | undefined;
  }
  if (value === undefined) {
    return undefined;
  }
  return () => value;
}

export function resolveConfiguredNativeWalletExecutionPolicy(
  execution: ExecutionConfig | undefined,
): NativeWalletExecutionPolicy | undefined {
  const sponsorship = execution?.sponsorship;
  if (!isEnabledSponsorship(sponsorship)) {
    return undefined;
  }

  return {
    executionKind: "wallet_sendCalls",
    sendCallsTimeoutMs: sponsorship.sendCallsTimeoutMs,
    sendCallsVersion: sponsorship.sendCallsVersion,
    sponsorship: {
      mode: sponsorship.mode,
      getPaymasterServiceContext: resolveMaybeFunction(
        sponsorship.paymasterServiceContext,
      ),
      getPaymasterServiceUrl: resolveMaybeFunction(
        sponsorship.paymasterServiceUrl,
      ),
    },
  };
}

