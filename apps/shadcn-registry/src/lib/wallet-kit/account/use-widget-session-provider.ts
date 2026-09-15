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

export class WalletSignInRequiredError extends Error {
  constructor() {
    super("Link your wallet to sign in to Aomi");
    this.name = "WalletSignInRequiredError";
  }
}
type WalletSessionProvider = AccountSessionProvider & {
  signIn: () => Promise<string | null>;
};

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
}): WalletSessionProvider | undefined {
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
  const credentialsReadyRef = useRef(credentialsReady);
  credentialsReadyRef.current = credentialsReady;

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
    let authorizedFingerprint: string | null = null;
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
      // Restore an unexpired tab session silently. A new or expired session
      // may exchange only while the user explicitly links this exact signer.
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
        exchange: async (options) => {
          const current = currentWalletAdapter();
          if ((await current.getFingerprint()) !== authorizedFingerprint)
            throw new WalletSignInRequiredError();
          return current.exchange(options);
        },
      };
    }
    // A wallet cannot renew silently, so retain its short-lived, origin-bound
    // widget session for this tab across page reloads. Provider credentials can
    // renew without another wallet prompt and stay memory-only.
    let storage: Storage | undefined;
    if (widgetAuth.mode === "wallet" && typeof window !== "undefined") {
      try {
        storage = window.sessionStorage;
      } catch {
        // Private browsing can deny storage access; in-memory auth still works.
      }
    }
    const session = createAccountSessionProvider({
      baseUrl,
      adapter,
      storage,
    }) as WalletSessionProvider;
    session.signIn = async () => {
      authorizedFingerprint = await adapter.getFingerprint();
      try {
        return (await session()) ?? null;
      } finally {
        authorizedFingerprint = null;
      }
    };
    return session;
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
    () => () => {
      // A page unload preserves the tab cache. Losing the connected signer or
      // provider credential is an explicit auth boundary and clears it.
      if (!credentialsReadyRef.current) {
        void accountSessionProvider?.revoke();
      }
      accountSessionProvider?.dispose();
    },
    [accountSessionProvider],
  );

  return accountSessionProvider;
}
