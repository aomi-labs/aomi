"use client";

export type EvmWalletId =
  | "metamask"
  | "rabby"
  | "coinbase"
  | "rainbow"
  | "walletconnect"
  | "baseAccount"
  | (string & {});

export type SvmWalletId =
  | "phantom"
  | "solflare"
  | "backpack"
  | "glow"
  | (string & {});

export type WalletId = EvmWalletId | SvmWalletId | (string & {});

export type EvmWalletPreset = "popular" | "evm-only" | "minimal";
export type SvmWalletPreset = "popular" | "minimal";

export const EVM_PRESETS: Record<EvmWalletPreset, readonly EvmWalletId[]> = {
  popular: ["metamask", "rabby", "coinbase", "walletconnect"],
  "evm-only": ["metamask", "rabby", "walletconnect"],
  minimal: ["metamask", "walletconnect"],
};

export const SVM_PRESETS: Record<SvmWalletPreset, readonly SvmWalletId[]> = {
  popular: ["phantom", "solflare", "backpack", "glow"],
  minimal: ["phantom", "solflare"],
};
