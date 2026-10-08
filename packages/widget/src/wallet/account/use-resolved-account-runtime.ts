"use client";

import type { AuthRuntime, SvmWalletRuntime } from "../composer/types";
import type { AccountConfig } from "../config/types";
import type { EvmWalletRuntime } from "../runtime/evm/wallet-runtime";
import { useAomiBackendAccountRuntime } from "./aomi-backend-runtime";
import { DISABLED_ACCOUNT_RUNTIME } from "./disabled-runtime";
import type { AccountRuntime } from "./types";

export function useResolvedAccountRuntime(input: {
  account?: AccountConfig;
  auth: AuthRuntime;
  evm: EvmWalletRuntime;
  svm?: SvmWalletRuntime;
}): AccountRuntime {
  const accountConfig =
    input.account !== false && input.account?.mode === "aomi-backend"
      ? input.account
      : null;
  const runtime = useAomiBackendAccountRuntime({
    enabled: Boolean(accountConfig),
    baseUrl: accountConfig?.baseUrl,
    authDomain: accountConfig?.authDomain,
    authUri: accountConfig?.authUri,
    widgetAuth: accountConfig?.widgetAuth,
    auth: input.auth,
    evm: input.evm,
    svm: input.svm,
  });
  return accountConfig ? runtime : DISABLED_ACCOUNT_RUNTIME;
}
