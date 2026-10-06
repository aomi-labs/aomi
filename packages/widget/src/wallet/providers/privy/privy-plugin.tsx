"use client";

import { type ReactNode, useMemo } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { SmartWalletsProvider } from "@privy-io/react-auth/smart-wallets";
import { registerWalletBrand } from "../../catalog/wallet-branding";
import {
  registerWalletProvider,
  type WalletProviderPlugin,
} from "../plugin-registry";
import { AomiPrivyPluginProvider } from "./PrivyPluginProvider";
import { buildPrivyClientConfig, toPrivyLoginMethods } from "./privy-auth";
import type { AuthConfig, ProvidersConfig } from "../../config/types";
import { safeEnv } from "../../env";

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
}: {
  auth?: AuthConfig;
  children: ReactNode;
  providers?: ProvidersConfig;
}) {
  const enabled = isPrivyAuth(auth);
  const privy = providers?.privy === false ? undefined : providers?.privy;
  const appId =
    privy?.appId ?? safeEnv(() => process.env.NEXT_PUBLIC_PRIVY_APP_ID);
  const config = useMemo(
    () =>
      buildPrivyClientConfig({
        appLogoUrl: privy?.appLogoUrl,
        appName: privy?.appName,
        // The additive plugin uses Aomi's external-wallet runtime. A second
        // Privy WalletConnect client duplicates its Core and session storage.
        walletConnectEnabled: false,
        loginMethods: enabled ? toPrivyLoginMethods(auth?.methods) : undefined,
      }),
    [auth, enabled, privy?.appLogoUrl, privy?.appName],
  );

  if (!enabled || !appId) {
    return <>{children}</>;
  }

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
    return Boolean(
      enabled &&
      (privy?.appId ?? safeEnv(() => process.env.NEXT_PUBLIC_PRIVY_APP_ID)),
    );
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

registerAomiPrivyWalletProvider();
