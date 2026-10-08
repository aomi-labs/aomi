/**
 * Building blocks for hosts that compose AomiFrame themselves: the wallet kit,
 * account and settings UI, Library, and the UI primitives the widget uses.
 *
 * Hosts keep authentication, routing, persistence and transport policy; the
 * reusable behaviour lives here so the portal and AomiWidget share one copy.
 */

// Wallet kit
export {
  AomiWalletKitContextProvider,
  useAomiWalletKit,
} from "./wallet/context";
export {
  AomiWalletKitProvider,
  type AomiWalletKitProviderInput,
  type AomiWalletKitProviderProps,
} from "./wallet/config/aomi-wallet-kit-provider";
export type {
  AomiAccount,
  AomiSessionIdentity,
  AomiSessionStatus,
  AomiWalletKit,
} from "./wallet/types";
export type {
  AccountWallet,
  AomiUserRef,
  LinkedAuthAccount,
} from "./wallet/account/types";
export {
  AOMI_SESSION_BOOTING_IDENTITY,
  AOMI_SESSION_DISCONNECTED_IDENTITY,
  formatAuthMethod,
  formatWalletProvider,
  inferAuthMethod,
} from "./wallet/identity";
export { AomiWalletNetworkPreferencesProvider } from "./wallet/network-preferences";
export {
  isFullTestnet,
  parseRpcOverrides,
  useFullTestnet,
} from "./wallet/full-testnet-config";
export { signOutAndDisconnect } from "./wallet/account/sign-out";
export {
  requestWalletPickerOpen,
  WalletSignInOptionsContext,
} from "./wallet/picker/wallet-picker-context";
export {
  DualWalletBar,
  type DualWalletBarProps,
} from "./wallet/dual-wallet-bar";
export type { WalletAccountMenuOptions } from "./account/account-menu-types";
export {
  usePrivyDelegation,
  type PrivyDelegationContextValue,
} from "./wallet/providers/privy/privy-delegation-context";
export { createWidgetX402Client } from "./wallet/payment-client";
export { SvmWalletBindingGate } from "./wallet/svm-wallet-binding-gate";
export { useSvmWalletBinding } from "./wallet/use-svm-wallet-binding";

// Account, settings and Library
export { ShellTransportProvider } from "./account/transport";
export { SettingsModal, type SettingsTab } from "./account/settings-modal";
export { HeaderControls } from "./frame/header-controls";
export { useAccountSnapshot } from "./account/account-snapshot";
export { useRuntimeAccount } from "./frame/runtime-account";
export { PackageIcon } from "./library/package-row";
export { toCatalogPackage } from "./library/packages-catalog";
export { PackagesModal } from "./library/packages-modal";
export { usePortalWalletAccountMenu } from "./account/use-portal-wallet-account-menu";
export type { DelegatedAccountView, WalletPolicy } from "./account/types";
export { StatementView } from "./account/usage/statement-view";
export {
  Chip,
  MatrixTable,
  Meter,
  OutcomeTable,
  StatementSection,
  usd,
} from "./account/usage/usage-shared";
export {
  useAccountOverview,
  useAccountOverviewStore,
} from "./account/account-overview";
export {
  accountScopedFetch,
  getBackendUrl,
  sessionScopedFetch,
} from "./account/settings-api";
export { useSettings } from "./account/use-settings";
export {
  requestSettingsOpen,
  useSettingsOpenRequest,
} from "./account/settings-events";

// Frame pieces and primitives
export {
  NetworkSelect,
  type NetworkSelectProps,
} from "./controls/network-select";
export {
  DEFAULT_SIDEBAR_PRODUCTS,
  type SidebarProduct,
} from "./sidebar/thread-list-sidebar";
export { useActivityPanel } from "./sidebar/activity/activity-panel-context";
export { NotificationToaster } from "./frame/notification";
export { AomiLogo, type AomiLogoProps } from "./ui/aomi-logo";
export { AomiMark } from "./ui/aomi-mark";
export { Button } from "./ui/button";
export { Input } from "./ui/input";
export { ModalBackdrop } from "./ui/modal-backdrop";
export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./ui/card";
export {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useOptionalSidebar,
} from "./ui/sidebar";
export { testIds, type TestId } from "./test-ids";

// Earlier exports with no place in this entry; each keeps working until the
// next major release.
import type { UsageFixtureData as UsageFixture } from "./account/usage/types";
import { getAppIcon as appIcon } from "./icons/app-map";
import { getSkillIcon as skillIcon } from "./icons/skills/skill-icons";
import {
  skillIconGenericAliases as genericAliases,
  skillIconSources as iconSources,
} from "./icons/skills/source-manifest";
import {
  CURATED_APP_IDS as curatedAppIds,
  resolveAppIdentity as appIdentity,
} from "./lib/apps/app-identity";

/** @deprecated A test fixture shape, not host API. Removed in @aomi-labs/widget 4.0. */
export type UsageFixtureData = UsageFixture;
/** @deprecated Development audit helper, not host API. Removed in @aomi-labs/widget 4.0. */
export const getAppIcon: typeof appIcon = appIcon;
/** @deprecated Development audit helper, not host API. Removed in @aomi-labs/widget 4.0. */
export const getSkillIcon: typeof skillIcon = skillIcon;
/** @deprecated Development audit helper, not host API. Removed in @aomi-labs/widget 4.0. */
export const skillIconGenericAliases: typeof genericAliases = genericAliases;
/** @deprecated Development audit helper, not host API. Removed in @aomi-labs/widget 4.0. */
export const skillIconSources: typeof iconSources = iconSources;
/** @deprecated Development audit helper, not host API. Removed in @aomi-labs/widget 4.0. */
export const CURATED_APP_IDS: typeof curatedAppIds = curatedAppIds;
/** @deprecated Development audit helper, not host API. Removed in @aomi-labs/widget 4.0. */
export const resolveAppIdentity: typeof appIdentity = appIdentity;
