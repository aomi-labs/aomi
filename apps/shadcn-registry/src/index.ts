// Main entry point for @aomi-labs/widget-lib
// Re-export the main AomiFrame component
export { AomiFrame } from "./components/aomi-frame";
export { AomiLogo, type AomiLogoProps } from "./components/aomi-logo";
export { AomiMark } from "./components/aomi-mark";
export {
  DEFAULT_SIDEBAR_PRODUCTS,
  type SidebarProduct,
} from "./components/assistant-ui/threadlist-sidebar";
export {
  AomiWidget,
  type AomiWidgetProps,
  type CrossOriginWidgetAuth,
  type WalletPresentationConfig,
} from "./components/aomi-widget";

// Dual-wallet UI
export {
  DualWalletBar,
  type DualWalletBarProps,
} from "./components/control-bar/dual-wallet-bar";
export type { WalletAccountMenuOptions } from "./components/control-bar/account-menu-types";

// Per-thread network picker (used by hosts that lift it into their chrome)
export {
  NetworkSelect,
  type NetworkSelectProps,
} from "./components/control-bar/network-select";

// Notification UI
export { NotificationToaster } from "./components/ui/notification";

// UI Components
export { Button } from "./components/ui/button";
export { Input } from "./components/ui/input";
export { ModalBackdrop } from "./components/ui/modal-backdrop";
export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./components/ui/card";
export {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "./components/ui/sidebar";

// Re-export types and utilities from @aomi-labs/react
export type { ChainInfo, UserConfig } from "@aomi-labs/react";
export {
  formatAddress,
  getChainInfo,
  getNetworkName,
  SUPPORTED_CHAINS,
} from "@aomi-labs/react";
export { ExtUserProvider, useUser, UserState } from "@aomi-labs/react";
export {
  arcTestnet,
  megaeth,
  monad,
  monadTestnet,
  robinhood,
} from "@aomi-labs/client";
export type {
  AccountWallet,
  AomiAccount,
  AomiUserRef,
  AomiWalletKit,
  AomiSessionIdentity,
  AomiSessionStatus,
  LinkedAuthAccount,
} from "./lib/wallet-kit";
export {
  AomiWalletKitContextProvider,
  AomiWalletKitProvider,
  signOutAndDisconnect,
  useAomiWalletKit,
} from "./lib/wallet-kit";
export {
  usePrivyDelegation,
  type PrivyDelegationContextValue,
} from "./lib/wallet-kit/providers/privy/privy-delegation-context";
export {
  AOMI_SESSION_BOOTING_IDENTITY,
  AOMI_SESSION_DISCONNECTED_IDENTITY,
  formatAuthMethod,
  formatWalletProvider,
  inferAuthMethod,
} from "./lib/wallet-kit";
export {
  FullTestnetWalletRouter,
  isFullTestnet,
  useFullTestnet,
} from "./lib/wallet-kit";
