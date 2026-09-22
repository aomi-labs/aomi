"use client";

import {
  usePrivy,
  useSignTransaction,
  useWallets,
  type ConnectedWallet,
  type PrivyClientConfig,
} from "@privy-io/react-auth";
import { useSolanaWallets } from "@privy-io/react-auth/solana";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import type { Chain } from "viem";
import type { AomiLoginMethod, AomiWalletOption } from "../../types";
import type { AuthMethodId } from "../../config/types";

export type PrivyHook = ReturnType<typeof usePrivy>;
export type PrivyAccessTokenHook = PrivyHook & {
  getAccessToken?: () => Promise<string | null>;
  getIdentityToken?: () => Promise<string | null>;
};
export type SmartWalletsHook = ReturnType<typeof useSmartWallets>;
export type SolanaWalletsHook = ReturnType<typeof useSolanaWallets>;
export type WalletsHook = ReturnType<typeof useWallets>;
export type SignTransactionHook = ReturnType<typeof useSignTransaction>;
export type PrivyUser = PrivyHook["user"];
export type PrivySolanaWallet = SolanaWalletsHook["wallets"][number];
export type PrivyConnectedWallet = ConnectedWallet;
export type PrivyEmbeddedEvmUserWallet = {
  id?: string | null;
  address: string;
  chainType?: string;
  walletClientType?: string;
  connectorType?: string;
  imported?: boolean;
};

const DISCONNECTED_PRIVY: PrivyAccessTokenHook = {
  ready: false,
  authenticated: false,
  user: null,
  login: async () => undefined,
  logout: async () => undefined,
  getAccessToken: async () => null,
  getIdentityToken: async () => null,
} as unknown as PrivyAccessTokenHook;

const DISCONNECTED_SMART_WALLETS: SmartWalletsHook = {
  client: undefined,
  getClientForChain: async () => undefined,
} as unknown as SmartWalletsHook;

const DISCONNECTED_SOLANA_WALLETS: SolanaWalletsHook = {
  wallets: [],
  ready: false,
} as unknown as SolanaWalletsHook;

const DISCONNECTED_WALLETS: WalletsHook = {
  wallets: [],
  ready: false,
} as unknown as WalletsHook;

const DISCONNECTED_SIGN_TRANSACTION: SignTransactionHook = {
  signTransaction: async () => {
    throw new Error("Privy transaction signing is not available");
  },
};

const AOMI_LOGIN_METHODS = new Set<AomiLoginMethod>([
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
  "wagmi",
  "passkey",
  "wallet",
]);

export function useSafePrivy(): PrivyAccessTokenHook {
  try {
    return usePrivy() as PrivyAccessTokenHook;
  } catch {
    return DISCONNECTED_PRIVY;
  }
}

export function useSafeSmartWallets(): SmartWalletsHook {
  try {
    return useSmartWallets();
  } catch {
    return DISCONNECTED_SMART_WALLETS;
  }
}

export function useSafeSvmWallets(): SolanaWalletsHook {
  try {
    return useSolanaWallets();
  } catch {
    return DISCONNECTED_SOLANA_WALLETS;
  }
}

export function useSafeWallets(): WalletsHook {
  try {
    return useWallets();
  } catch {
    return DISCONNECTED_WALLETS;
  }
}

export function useSafeSignTransaction(): SignTransactionHook {
  try {
    return useSignTransaction();
  } catch {
    return DISCONNECTED_SIGN_TRANSACTION;
  }
}

/** Privy embedded EVM wallet client types. `privy` (v1) and `privy-v2` (v2)
 *  are the values `ConnectedWallet.walletClientType` takes for embedded
 *  wallets created within Privy's app (as documented on the `Wallet` type:
 *  "If the value is `privy`, then this is a privy embedded wallet"). External
 *  wallets (MetaMask, Rainbow, …) carry their own client type. */
const PRIVY_EMBEDDED_CLIENT_TYPES = new Set(["privy", "privy-v2"]);

/** Pick the Privy embedded EVM wallet from a `useWallets()` snapshot — the
 *  non-imported, Privy-custodied EOA that the user created on login. Returns
 *  the first match (a user has at most one embedded EVM wallet per Privy
 *  app). External wallets and imported embedded wallets are skipped: external
 *  wallets are surfaced through wagmi connectors, and imported wallets are
 *  not custodied by this Privy app. Used to dispatch the embedded-session
 *  signal so the registry injects a synthetic EVM connection (mirroring the
 *  Para session source), giving the embedded EVM wallet "connected now" /
 *  write capability. */
export function pickPrivyEmbeddedEvmWallet(
  wallets: readonly ConnectedWallet[],
): ConnectedWallet | undefined {
  return wallets.find(
    (wallet) =>
      wallet.type === "ethereum" &&
      !wallet.imported &&
      PRIVY_EMBEDDED_CLIENT_TYPES.has(wallet.walletClientType),
  );
}

function isPrivyEmbeddedEvmUserWallet(
  wallet: unknown,
): wallet is PrivyEmbeddedEvmUserWallet {
  if (!wallet || typeof wallet !== "object") return false;
  const candidate = wallet as PrivyEmbeddedEvmUserWallet;
  return (
    typeof candidate.address === "string" &&
    /^0x[0-9a-fA-F]{40}$/.test(candidate.address) &&
    candidate.imported !== true &&
    (candidate.chainType === undefined ||
      candidate.chainType === "ethereum" ||
      candidate.chainType === "evm") &&
    (candidate.walletClientType === undefined ||
      PRIVY_EMBEDDED_CLIENT_TYPES.has(candidate.walletClientType))
  );
}

export function pickPrivyEmbeddedEvmUserWallet(
  user: PrivyUser,
): PrivyEmbeddedEvmUserWallet | undefined {
  if (!user) return undefined;
  const direct = (user as { wallet?: unknown }).wallet;
  if (isPrivyEmbeddedEvmUserWallet(direct)) return direct;
  const linked = ((user as { linkedAccounts?: unknown[] }).linkedAccounts ??
    []) as unknown[];
  return linked.find(isPrivyEmbeddedEvmUserWallet);
}

function asAomiLoginMethod(
  value: string | undefined,
): AomiLoginMethod | undefined {
  return value && AOMI_LOGIN_METHODS.has(value as AomiLoginMethod)
    ? (value as AomiLoginMethod)
    : undefined;
}

export function inferPrivyAuthMethod(
  user: PrivyUser,
): AomiLoginMethod | undefined {
  if (!user) return undefined;
  const accountTypePriority: Array<[string, AomiLoginMethod]> = [
    ["google_oauth", "google"],
    ["github_oauth", "github"],
    ["apple_oauth", "apple"],
    ["discord_oauth", "discord"],
    ["twitter_oauth", "x"],
    ["telegram", "telegram"],
    ["farcaster", "farcaster"],
    ["email", "email"],
    ["phone", "phone"],
    ["wallet", "wagmi"],
  ];
  const linked = (user.linkedAccounts ?? []) as Array<{ type?: string }>;
  for (const [privyType, label] of accountTypePriority) {
    if (linked.some((acc) => acc?.type === privyType)) return label;
  }
  const first = linked[0]?.type;
  return asAomiLoginMethod(
    typeof first === "string" ? first.toLowerCase() : undefined,
  );
}

export function inferPrivyPrimaryLabel(user: PrivyUser): string | undefined {
  if (!user) return undefined;
  const u = user as unknown as {
    email?: { address?: string };
    google?: { email?: string };
    apple?: { email?: string };
    discord?: { username?: string };
    twitter?: { username?: string };
    github?: { username?: string };
    telegram?: { username?: string; firstName?: string };
    farcaster?: { username?: string; displayName?: string };
    phone?: { number?: string };
  };
  return (
    u.email?.address ??
    u.google?.email ??
    u.apple?.email ??
    u.discord?.username ??
    u.twitter?.username ??
    u.github?.username ??
    u.telegram?.username ??
    u.telegram?.firstName ??
    u.farcaster?.username ??
    u.farcaster?.displayName ??
    u.phone?.number ??
    undefined
  );
}

export function privyLoginMethodsToOptions(
  methods: PrivyClientConfig["loginMethods"] | undefined,
): AomiWalletOption[] {
  const enabledMethods = (methods ?? [])
    .map((method) =>
      asAomiLoginMethod(method === "twitter" ? "x" : String(method)),
    )
    .filter((method): method is AomiLoginMethod => Boolean(method));

  if (enabledMethods.length === 0) return [];

  return [
    {
      id: "privy",
      label:
        enabledMethods.length === 1 && enabledMethods[0] === "google"
          ? "Email or Google"
          : "Email, wallet, or social",
      family: "multichain",
      kind: "social",
      status: "available",
      ready: true,
      description: "Fast account sign-in",
    },
  ];
}

export function toPrivyLoginMethods(
  methods: readonly AuthMethodId[] | undefined,
): PrivyClientConfig["loginMethods"] | undefined {
  if (!methods) return undefined;
  type PrivyLoginMethod = NonNullable<
    PrivyClientConfig["loginMethods"]
  >[number];
  const map = {
    apple: "apple",
    discord: "discord",
    email: "email",
    farcaster: "farcaster",
    github: "github",
    google: "google",
    passkey: "passkey",
    phone: "sms",
    telegram: "telegram",
    wallet: "wallet",
    x: "twitter",
  } as const satisfies Partial<Record<AuthMethodId, PrivyLoginMethod>>;
  const resolved: PrivyLoginMethod[] = [];
  for (const method of methods) {
    const loginMethod = map[method];
    if (loginMethod) resolved.push(loginMethod);
  }
  return resolved.length ? resolved : undefined;
}

/**
 * Single source of truth for the Privy client config shared by the standalone
 * `AomiPrivyProvider` and the additive `PrivyAuthLayer`. The standalone provider
 * passes the extra `defaultChain`/`supportedChains`/`walletConnectProjectId`
 * fields; the additive layer omits them.
 */
export function buildPrivyClientConfig(opts: {
  appLogoUrl?: string;
  appName?: string;
  loginMethods?: PrivyClientConfig["loginMethods"];
  defaultChain?: Chain;
  supportedChains?: readonly Chain[];
  walletConnectProjectId?: string;
}): PrivyClientConfig {
  return {
    appearance: {
      walletList: ["detected_wallets", "metamask", "wallet_connect"],
      logo: opts.appLogoUrl,
    },
    embeddedWallets: {
      ethereum: { createOnLogin: "all-users" },
      solana: { createOnLogin: "all-users" },
    },
    loginMethods: opts.loginMethods,
    ...(opts.defaultChain ? { defaultChain: opts.defaultChain } : {}),
    ...(opts.supportedChains
      ? { supportedChains: opts.supportedChains as unknown as Chain[] }
      : {}),
    ...(opts.walletConnectProjectId
      ? { walletConnectCloudProjectId: opts.walletConnectProjectId }
      : {}),
    ...(opts.appName ? { appName: opts.appName } : {}),
  } as PrivyClientConfig;
}
