"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useUser } from "@aomi-labs/react";
import { AOMI_SESSION_DISCONNECTED_IDENTITY } from "./identity";
import type { AomiWalletKit } from "./types";

const DISCONNECTED_WALLET_KIT: AomiWalletKit = {
  identity: AOMI_SESSION_DISCONNECTED_IDENTITY,
  isReady: true,
  isSwitchingChain: false,
  canConnect: false,
  canOpenAccountUI: false,
  canDisconnect: false,
  accounts: [],
  selectAccount: async () => undefined,
  evmWallets: [],
  solanaWallets: [],
  socialLoginOptions: [],
  supportedNetworks: {
    evm: [],
    solana: [],
  },
  connect: async () => undefined,
};

const AomiWalletKitContext =
  createContext<AomiWalletKit>(DISCONNECTED_WALLET_KIT);

function toSvmCapabilities(
  capabilities: AomiWalletKit["identity"]["svmCapabilities"],
): string[] | undefined {
  if (!capabilities) return undefined;
  return Object.entries(capabilities)
    .filter(([, enabled]) => enabled)
    .map(([name]) =>
      name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
    );
}

function AomiWalletKitSync({ walletKit }: { walletKit: AomiWalletKit }) {
  const { setUser } = useUser();
  const identity = walletKit.identity;

  useEffect(() => {
    // Account-abstraction and sponsorship are backend authority: they are
    // resolved by the execution-profile endpoint and per-execution operation
    // payloads, never forwarded from identity into user_state. Only FE-owned
    // connection facts (owner, chain, provider, auth) are synced here.
    setUser({
      connection: {
        is_connected: identity.isConnected,
        provider: identity.isConnected
          ? (identity.sessionProvider ?? identity.embeddedProvider ?? null)
          : null,
        auth_method: identity.isConnected ? (identity.authMethod ?? null) : null,
      },
      evm: {
        address: identity.address ?? null,
        chain_id: identity.chainId ?? null,
      },
      svm: {
        address: identity.svmAddress ?? null,
        cluster: identity.svmCluster ?? undefined,
        wallet_name: identity.svmWalletName ?? null,
        transport: identity.svmTransport ?? null,
        capabilities: toSvmCapabilities(identity.svmCapabilities) ?? [],
      },
    });
  }, [
    identity.address,
    identity.authMethod,
    identity.chainId,
    identity.isConnected,
    identity.svmCapabilities,
    identity.svmCluster,
    identity.svmTransport,
    identity.svmWalletName,
    identity.svmAddress,
    identity.embeddedProvider,
    identity.sessionProvider,
    setUser,
  ]);

  return null;
}

export function AomiWalletKitContextProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: AomiWalletKit;
}) {
  return (
    <AomiWalletKitContext.Provider value={value}>
      <AomiWalletKitSync walletKit={value} />
      {children}
    </AomiWalletKitContext.Provider>
  );
}

export function useAomiWalletKit(): AomiWalletKit {
  return useContext(AomiWalletKitContext);
}
