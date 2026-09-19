"use client";

import type {
  AomiSessionIdentity,
  AomiLoginMethod,
  AuthProviderId,
  SessionProvider,
} from "./types";

export const AOMI_SESSION_DISCONNECTED_IDENTITY: AomiSessionIdentity = {
  status: "disconnected",
  isConnected: false,
  address: undefined,
  walletKind: undefined,
  chainId: undefined,
  svmAddress: undefined,
  walletProviderSubject: undefined,
  authMethod: undefined,
  authValue: undefined,
  authVerifiedAt: undefined,
};

export const AOMI_SESSION_BOOTING_IDENTITY: AomiSessionIdentity = {
  status: "booting",
  isConnected: false,
  address: undefined,
  walletKind: undefined,
  chainId: undefined,
  svmAddress: undefined,
  walletProviderSubject: undefined,
  authMethod: undefined,
  authValue: undefined,
  authVerifiedAt: undefined,
};

export function formatWalletAddress(address?: string): string | undefined {
  if (!address) return undefined;
  return `${address.slice(0, 5)}..${address.slice(-2)}`;
}

export function formatWalletProvider(
  provider?: SessionProvider | AuthProviderId,
): string | undefined {
  if (!provider) return undefined;
  const labelMap: Record<string, string> = {
    none: "Wallet",
    para: "Para",
    privy: "Privy",
    baseAccount: "Base Account",
  };
  return labelMap[provider] ?? provider;
}

export function formatAuthMethod(method?: AomiLoginMethod): string | undefined {
  if (!method) return undefined;
  const labelMap: Record<AomiLoginMethod, string> = {
    google: "Google",
    github: "GitHub",
    apple: "Apple",
    facebook: "Facebook",
    x: "X",
    discord: "Discord",
    farcaster: "Farcaster",
    telegram: "Telegram",
    email: "Email",
    phone: "Phone",
    passkey: "Passkey",
    wallet: "Wallet",
    wagmi: "External Wallet",
  };
  return labelMap[method];
}

const OAUTH_METHODS: ReadonlySet<AomiLoginMethod> = new Set<AomiLoginMethod>([
  "google",
  "apple",
  "facebook",
  "x",
  "discord",
  "github",
  "farcaster",
  "telegram",
  "email",
  "phone",
]);

export function inferAuthMethod(
  authMethods: unknown,
): AomiLoginMethod | undefined {
  if (!(authMethods instanceof Set) || authMethods.size === 0) return undefined;

  for (const method of authMethods) {
    if (typeof method !== "string") continue;
    const normalized = method.toLowerCase();
    if (OAUTH_METHODS.has(normalized as AomiLoginMethod)) {
      return normalized as AomiLoginMethod;
    }
  }
  return undefined;
}
