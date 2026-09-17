/**
 * Shared UI contracts used by first-party hosts that compose AomiFrame.
 *
 * Keep host authentication, routing, persistence, and transport policy in the
 * host. Reusable account, settings, Library, and presentation behavior belongs
 * here so Portal and the public AomiWidget do not grow parallel implementations.
 */
export {
  SettingsModal,
  type SettingsTab,
} from "./components/account-shell/components/settings/settings-modal";
export { HeaderControls } from "./components/account-shell/components/shell/header-controls";
export { PackageIcon } from "./components/account-shell/components/shell/package-row";
export { toCatalogPackage } from "./components/account-shell/components/shell/packages-catalog";
export { PackagesModal } from "./components/account-shell/components/shell/packages-modal";
export { usePortalWalletAccountMenu } from "./components/account-shell/components/shell/use-portal-wallet-account-menu";

export type {
  DelegatedAccountView,
  WalletPolicy,
} from "./components/account-shell/features/account/types";
export { StatementView } from "./components/account-shell/features/usage";
export type { UsageFixtureData } from "./components/account-shell/features/usage/types";
export {
  Chip,
  MatrixTable,
  Meter,
  OutcomeTable,
  StatementSection,
  usd,
} from "./components/account-shell/features/usage/usage-shared";

export {
  useAccountOverview,
  useAccountOverviewStore,
} from "./components/account-shell/lib/account-overview";
export {
  accountScopedFetch,
  getBackendUrl,
  sessionScopedFetch,
} from "./components/account-shell/lib/settings-api";
export { useSettings } from "./components/account-shell/lib/use-settings";

// Development audit pages are first-party host composition, not public widget
// API. Keeping them here lets Portal avoid importing widget-owned source paths.
export { getAppIcon } from "./components/icons/app-map";
export { getSkillIcon } from "./components/icons/skills";
export {
  skillIconGenericAliases,
  skillIconSources,
} from "./components/icons/skills/source-manifest";
export {
  CURATED_APP_IDS,
  resolveAppIdentity,
} from "./lib/apps/app-identity";
