"use client";

export { AomiWalletKitContextProvider, useAomiWalletKit } from "./context";
export {
  AomiWalletKitProvider,
  type AomiWalletKitProviderInput,
  type AomiWalletKitProviderProps,
} from "./config";
export type {
  AomiAccount,
  AomiAccountCredential,
  AomiLoginMethod,
  AomiNetworkTarget,
  AomiSessionIdentity,
  AomiSessionStatus,
  AomiTransactionExecution,
  AomiTxResult,
  AomiWalletKit,
  AomiWalletOption,
  PublicWalletFamily,
  SvmCluster,
  SvmNetworkOption,
  SvmWalletDescriptor,
  WalletFamily,
} from "./types";
export type {
  AccountWallet,
  AomiUserRef,
  LinkedAuthAccount,
} from "./account/types";
export {
  AOMI_SESSION_BOOTING_IDENTITY,
  AOMI_SESSION_DISCONNECTED_IDENTITY,
  formatAuthMethod,
  formatWalletAddress,
  formatWalletProvider,
  inferAuthMethod,
} from "./identity";
export {
  AomiWalletNetworkPreferencesProvider,
  useAomiWalletNetworkPreferences,
  useOptionalAomiWalletNetworkPreferences,
} from "./network-preferences";
export {
  canonicalWalletKey,
  normalizeWalletOptionId,
  registerWalletBrand,
} from "./catalog/wallet-branding";
export {
  resolveAomiSvmWalletIds,
  resolveAomiSvmConfig,
  SVM_PRESETS,
} from "./catalog/svm-wallet-catalog";
export type {
  EvmWalletId,
  EvmWalletPreset,
  SvmWalletId,
  SvmWalletPreset,
  WalletId,
} from "./catalog/wallet-ids";
export {
  FullTestnetWalletRouter,
  isFullTestnet,
  useFullTestnet,
} from "./full-testnet-wallet-routing";
export { useWalletActivationGuard } from "./use-wallet-activation-guard";
export { useActionCapabilities } from "./use-action-capabilities";
export { signOutAndDisconnect } from "./account/sign-out";
