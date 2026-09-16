"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  createProviderCredentialAdapter,
  createSiweAccountAuthAdapter,
  createSiwsAccountAuthAdapter,
  createAccountSessionProvider,
  type AccountAuthAdapter,
  type AccountSessionProvider,
} from "@aomi-labs/client";
import type { AuthRuntime, SvmWalletRuntime } from "../composer/types";
import type { EvmWalletRuntime } from "../runtime/evm/wallet-runtime";
import type { WidgetAuthConfig } from "../config/types";
import { utf8ToBase64 } from "./encoding";

export type { WidgetAuthConfig };

/**
 * Single predicate both layers consult to decide whether the widget currently
 * has a usable credential source to mint its own backend session. Keeping the
 * provider-build guard (`useAccountSessionProvider`) and the signed-out gate
 * (`useAomiBackendAccountRuntime`) on the same rule stops them from disagreeing
 * — e.g. an authenticated-but-credential-less provider state that would
 * otherwise fall back to cross-origin cookie mode and 401.
 *
 * - `provider` mode is ready once the host is authenticated AND exposes an
 *   exchangeable credential.
 * - `wallet` mode is ready once a connected external wallet can sign (EVM SIWE
 *   or SVM SIWS); before that it is idle, not an error.
 */
export function widgetCredentialsReady(input: {
  widgetAuth: WidgetAuthConfig;
  authStatus: AuthRuntime["status"];
  hasAuthCredential: boolean;
  evm: EvmWalletRuntime;
  svm?: SvmWalletRuntime;
}): boolean {
  if (input.widgetAuth.mode === "provider") {
    return input.authStatus === "authenticated" && input.hasAuthCredential;
  }
  const connection = input.evm.activeEvmConnection;
  if (connection?.address && connection.chainId && input.evm.signMessageAsync) {
    return true;
  }
  const identity = input.svm?.identity(Date.now());
  return Boolean(identity?.address && input.svm?.execution.signSolanaMessage);
}

/**
 * Build (and dispose) the cross-origin widget session provider for the account
 * runtime. Live auth/EVM/SVM runtimes are mirrored through refs so the memoized
 * provider reads current signers without being rebuilt on every render; it is
 * only rebuilt when a flat identity/config primitive changes.
 */
export function useAccountSessionProvider(input: {
  baseUrl?: string;
  widgetAuth?: WidgetAuthConfig;
  auth: AuthRuntime;
  evm: EvmWalletRuntime;
  svm?: SvmWalletRuntime;
}): AccountSessionProvider | undefined {
  const { baseUrl, widgetAuth, auth, evm, svm } = input;
  const authStatus = auth.status;
  const authSubject = auth.subject;
  const hasAuthCredential = Boolean(auth.getCredential);
  const mode = widgetAuth?.mode;
  const provider =
    widgetAuth?.mode === "provider" ? widgetAuth.provider : undefined;
  const environment =
    widgetAuth?.mode === "provider" ? widgetAuth.environment : undefined;
  const credentialsReady = widgetAuth
    ? widgetCredentialsReady({
        widgetAuth,
        authStatus,
        hasAuthCredential,
        evm,
        svm,
      })
    : false;

  const authRef = useRef(auth);
  const evmRef = useRef(evm);
  const svmRef = useRef(svm);
  authRef.current = auth;
  evmRef.current = evm;
  svmRef.current = svm;

  const accountSessionProvider = useMemo(() => {
    if (!widgetAuth || !baseUrl) return undefined;
    // Do not publish a required bearer source until the configured auth mode
    // can actually mint one. This applies equally to provider and wallet mode:
    // the main Aomi client consumes this provider for threads, REST, and SSE,
    // not only the account runtime, so returning a throwing wallet adapter here
    // would still turn the default signed-out widget boot into an auth error.
    if (!credentialsReady) return undefined;
    let adapter: AccountAuthAdapter;
    if (widgetAuth.mode === "provider") {
      // Provider SDKs briefly report a connected account before their
      // exchangeable credential is ready. Do not expose a required bearer
      // source during that gap: catalog loaders would consume it immediately
      // and turn normal auth boot into "Widget auth identity is unavailable".
      // Same readiness rule the runtime's signed-out gate uses.
      const config = widgetAuth;
      adapter = createProviderCredentialAdapter({
        provider: config.provider,
        environment: config.environment,
        getCredential: async () => authRef.current.getCredential?.() ?? null,
        getSubject: () => authRef.current.subject ?? null,
        signOut: async () => authRef.current.logout?.(),
      });
    } else {
      // SIWE/SIWS wallet mode has no silent refresh: the widget session
      // provider re-runs the adapter's getFingerprint/exchange to renew, which
      // re-prompts the wallet to sign roughly every 29 min (the WST lifetime
      // minus the refresh window). The fingerprint also includes chainId, so
      // switching chains changes the identity and forces a fresh re-sign. Both
      // are currently intended: wallet mode has no offline key to refresh with.
      const currentWalletAdapter = (): AccountAuthAdapter => {
        const evmRuntime = evmRef.current;
        const connection = evmRuntime.activeEvmConnection;
        const evmAddress = connection?.address;
        const evmChainId = connection?.chainId;
        const evmSignMessage = evmRuntime.signMessageAsync;
        if (evmAddress && evmChainId && evmSignMessage) {
          return createSiweAccountAuthAdapter({
            getSigner: async () => ({
              address: evmAddress,
              chainId: evmChainId,
              signMessage: async (message) => evmSignMessage({ message }),
            }),
          });
        }
        const svmRuntime = svmRef.current;
        const identity = svmRuntime?.identity(Date.now());
        const svmAddress = identity?.address;
        const signMessage = svmRuntime?.execution.signSolanaMessage;
        if (svmAddress && signMessage) {
          return createSiwsAccountAuthAdapter({
            getSigner: async () => ({
              address: svmAddress,
              chainId:
                svmRuntime?.selectedNetwork?.cluster ??
                identity?.cluster ??
                "solana:mainnet",
              signMessage: async (message) =>
                (
                  await signMessage({
                    message: utf8ToBase64(message),
                    cluster:
                      svmRuntime?.selectedNetwork?.cluster ?? identity?.cluster,
                  })
                ).signature,
            }),
          });
        }
        throw new Error(
          "Connect an external wallet to authenticate the widget",
        );
      };
      adapter = {
        getFingerprint: () => currentWalletAdapter().getFingerprint(),
        exchange: (options) => currentWalletAdapter().exchange(options),
      };
    }
    return createAccountSessionProvider({ baseUrl, adapter });
    // Refs supply live auth/evm/svm; the provider is only rebuilt when a flat
    // identity/config primitive below changes.
  }, [
    baseUrl,
    authStatus,
    authSubject,
    hasAuthCredential,
    mode,
    environment,
    provider,
    credentialsReady,
  ]);

  useEffect(
    () => () => accountSessionProvider?.dispose(),
    [accountSessionProvider],
  );

  return accountSessionProvider;
}
