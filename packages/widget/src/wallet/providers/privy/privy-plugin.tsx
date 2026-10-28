"use client";

import { type ReactNode, useMemo } from "react";
import { registerWalletBrand } from "@/wallet/catalog/wallet-branding";
import {
  registerWalletProvider,
  type WalletProviderPlugin,
} from "@/wallet/providers/plugin-registry";
import { AomiPrivyPluginProvider } from "./privy-plugin-provider";
import { buildPrivyClientConfig, toPrivyLoginMethods } from "./privy-auth";
import { privySdk } from "./privy-sdk";
import type { Chain } from "viem";
import type { AuthConfig, ProvidersConfig } from "@/wallet/config/types";

const PRIVY_BRAND_KEY = "privy";

registerWalletBrand({ key: PRIVY_BRAND_KEY, matchers: ["privy"] });

function isPrivyAuth(
  auth: AuthConfig | undefined,
): auth is Exclude<AuthConfig, false> & { provider: "privy" } {
  return auth !== false && auth?.provider === "privy";
}

function PrivyAuthLayer({
  auth,
  children,
  providers,
  supportedChains,
}: {
  auth?: AuthConfig;
  children: ReactNode;
  providers?: ProvidersConfig;
  supportedChains?: readonly Chain[];
}) {
  const enabled = isPrivyAuth(auth);
  const privy = providers?.privy === false ? undefined : providers?.privy;
  const appId = privy?.appId;
  // Depend on the methods, not the auth object, so a warm SDK keeps its config.
  const methods = enabled ? auth.methods : undefined;
  // Privy's embedded wallet switches only to chains in its config; without
  // the host's list it knows none of Aomi's own (Robinhood Chain, 4663).
  const chainKey = supportedChains?.map((chain) => chain.id).join(",");
  const config = useMemo(
    () =>
      buildPrivyClientConfig({
        appLogoUrl: privy?.appLogoUrl,
        appName: privy?.appName,
        // The additive plugin uses Aomi's external-wallet runtime. A second
        // Privy WalletConnect client duplicates its Core and session storage.
        walletConnectEnabled: false,
        loginMethods: enabled ? toPrivyLoginMethods(methods) : undefined,
        supportedChains: supportedChains?.length ? supportedChains : undefined,
      }),
    [enabled, methods, privy?.appLogoUrl, privy?.appName, chainKey],
  );

  if (!enabled || !appId) {
    return <>{children}</>;
  }

  const { PrivyProvider } = privySdk().auth;
  const { SmartWalletsProvider } = privySdk().smartWallets;
  return (
    <PrivyProvider appId={appId} config={config}>
      <SmartWalletsProvider>{children}</SmartWalletsProvider>
    </PrivyProvider>
  );
}

export const privyPlugin: WalletProviderPlugin = {
  id: "privy",
  authMode: "additive",
  isAvailable: ({ auth, providers }) => {
    const enabled = isPrivyAuth(auth);
    const privy = providers?.privy === false ? undefined : providers?.privy;
    return Boolean(enabled && privy?.appId);
  },
  wrap: (props) => <PrivyAuthLayer {...props} />,
  renderComposer: ({
    account,
    auth,
    children,
    execution,
    externalSvmWallet,
    solanaRuntimeConfig,
    supportedChains,
  }) => (
    <AomiPrivyPluginProvider
      supportedChains={supportedChains}
      loginMethods={
        isPrivyAuth(auth) ? toPrivyLoginMethods(auth.methods) : undefined
      }
      execution={execution}
      externalSvmWallet={externalSvmWallet}
      account={account}
      preferDirectSend={solanaRuntimeConfig?.preferDirectSend}
    >
      {children}
    </AomiPrivyPluginProvider>
  ),
  detectSugar: (input) => {
    if (
      input.auth !== false &&
      input.auth?.provider === "privy" &&
      "appId" in input.auth
    ) {
      return {
        children: input.children,
        providers: {
          privy: {
            appId: input.auth.appId,
            appName: input.auth.appName,
          },
        },
        auth: { provider: "privy", methods: input.auth.methods },
      };
    }
    return null;
  },
};

export function registerAomiPrivyWalletProvider(): void {
  registerWalletProvider(privyPlugin);
}
