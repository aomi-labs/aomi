// @aomi-labs/widget: the embeddable chat widget. Hosts that compose the frame
// themselves use "@aomi-labs/widget/frame" and "@aomi-labs/widget/host-composition".
export {
  AomiWidget,
  paraAuth,
  privyAuth,
  type AomiWidgetAuth,
  type AomiWidgetFeatures,
  type AomiWidgetProps,
  type AomiWidgetTheme,
  type CrossOriginWidgetAuth,
  type ParaAuthOptions,
  type PrivyAuthOptions,
  type WalletPresentationConfig,
} from "./frame/aomi-widget";
export type {
  AomiRoutingConfig,
  AomiRoutingTarget,
  DirectRoutingApp,
} from "./controls/routing";
export { preloadWalletProvider } from "./wallet/providers/plugin-registry";

// Everything below was exported before the API was narrowed. Each name keeps
// working until the next major release; none of it is used inside the widget.
import { AomiFrame as Frame } from "./frame/aomi-frame";
import * as host from "./host-composition";
import { AOMI_BOOTING_WALLET_KIT as BOOTING_KIT } from "./wallet/context";
import { FullTestnetWalletRouter as TestnetRouter } from "./wallet/full-testnet-wallet-routing";
import * as aomiReact from "@aomi-labs/react";
import * as aomiClient from "@aomi-labs/client";

/** @deprecated Import from "@aomi-labs/widget/frame". Removed in @aomi-labs/widget 4.0. */
export const AomiFrame: typeof Frame = Frame;

/** @deprecated No replacement; the wallet kit boots itself. Removed in @aomi-labs/widget 4.0. */
export const AOMI_BOOTING_WALLET_KIT: typeof BOOTING_KIT = BOOTING_KIT;
/** @deprecated The wallet kit routes testnet chains itself. Removed in @aomi-labs/widget 4.0. */
export const FullTestnetWalletRouter: typeof TestnetRouter = TestnetRouter;

/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export const WalletSignInOptionsContext: typeof host.WalletSignInOptionsContext =
  host.WalletSignInOptionsContext;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export const AomiLogo: typeof host.AomiLogo = host.AomiLogo;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export type AomiLogoProps = host.AomiLogoProps;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export const AomiMark: typeof host.AomiMark = host.AomiMark;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export const testIds: typeof host.testIds = host.testIds;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export type TestId = host.TestId;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export const useActivityPanel: typeof host.useActivityPanel =
  host.useActivityPanel;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export const DEFAULT_SIDEBAR_PRODUCTS: typeof host.DEFAULT_SIDEBAR_PRODUCTS =
  host.DEFAULT_SIDEBAR_PRODUCTS;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export type SidebarProduct = host.SidebarProduct;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export const DualWalletBar: typeof host.DualWalletBar = host.DualWalletBar;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export type DualWalletBarProps = host.DualWalletBarProps;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export type WalletAccountMenuOptions = host.WalletAccountMenuOptions;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export const NetworkSelect: typeof host.NetworkSelect = host.NetworkSelect;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export type NetworkSelectProps = host.NetworkSelectProps;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export const NotificationToaster: typeof host.NotificationToaster =
  host.NotificationToaster;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export const Button: typeof host.Button = host.Button;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export const Input: typeof host.Input = host.Input;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export const ModalBackdrop: typeof host.ModalBackdrop = host.ModalBackdrop;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export const Card: typeof host.Card = host.Card;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export const CardContent: typeof host.CardContent = host.CardContent;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export const CardDescription: typeof host.CardDescription =
  host.CardDescription;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export const CardFooter: typeof host.CardFooter = host.CardFooter;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export const CardHeader: typeof host.CardHeader = host.CardHeader;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export const CardTitle: typeof host.CardTitle = host.CardTitle;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export const SidebarMenu: typeof host.SidebarMenu = host.SidebarMenu;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export const SidebarMenuButton: typeof host.SidebarMenuButton =
  host.SidebarMenuButton;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export const SidebarMenuItem: typeof host.SidebarMenuItem =
  host.SidebarMenuItem;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export const useOptionalSidebar: typeof host.useOptionalSidebar =
  host.useOptionalSidebar;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export type AccountWallet = host.AccountWallet;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export type AomiAccount = host.AomiAccount;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export type AomiUserRef = host.AomiUserRef;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export type AomiWalletKit = host.AomiWalletKit;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export type AomiSessionIdentity = host.AomiSessionIdentity;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export type AomiSessionStatus = host.AomiSessionStatus;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export type LinkedAuthAccount = host.LinkedAuthAccount;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export const AomiWalletKitContextProvider: typeof host.AomiWalletKitContextProvider =
  host.AomiWalletKitContextProvider;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export const AomiWalletKitProvider: typeof host.AomiWalletKitProvider =
  host.AomiWalletKitProvider;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export const AomiWalletNetworkPreferencesProvider: typeof host.AomiWalletNetworkPreferencesProvider =
  host.AomiWalletNetworkPreferencesProvider;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export const signOutAndDisconnect: typeof host.signOutAndDisconnect =
  host.signOutAndDisconnect;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export const useAomiWalletKit: typeof host.useAomiWalletKit =
  host.useAomiWalletKit;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export const requestWalletPickerOpen: typeof host.requestWalletPickerOpen =
  host.requestWalletPickerOpen;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export const usePrivyDelegation: typeof host.usePrivyDelegation =
  host.usePrivyDelegation;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export type PrivyDelegationContextValue = host.PrivyDelegationContextValue;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export const AOMI_SESSION_BOOTING_IDENTITY: typeof host.AOMI_SESSION_BOOTING_IDENTITY =
  host.AOMI_SESSION_BOOTING_IDENTITY;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export const AOMI_SESSION_DISCONNECTED_IDENTITY: typeof host.AOMI_SESSION_DISCONNECTED_IDENTITY =
  host.AOMI_SESSION_DISCONNECTED_IDENTITY;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export const formatAuthMethod: typeof host.formatAuthMethod =
  host.formatAuthMethod;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export const formatWalletProvider: typeof host.formatWalletProvider =
  host.formatWalletProvider;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export const inferAuthMethod: typeof host.inferAuthMethod =
  host.inferAuthMethod;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export const parseRpcOverrides: typeof host.parseRpcOverrides =
  host.parseRpcOverrides;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export const isFullTestnet: typeof host.isFullTestnet = host.isFullTestnet;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export const useFullTestnet: typeof host.useFullTestnet = host.useFullTestnet;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export const ShellTransportProvider: typeof host.ShellTransportProvider =
  host.ShellTransportProvider;
/** @deprecated Import from "@aomi-labs/widget/host-composition". Removed in @aomi-labs/widget 4.0. */
export const createWidgetX402Client: typeof host.createWidgetX402Client =
  host.createWidgetX402Client;

/** @deprecated Import from "@aomi-labs/react". Removed in @aomi-labs/widget 4.0. */
export type ChainInfo = aomiReact.ChainInfo;
/** @deprecated Import from "@aomi-labs/react". Removed in @aomi-labs/widget 4.0. */
export type UserConfig = aomiReact.UserConfig;
/** @deprecated Import from "@aomi-labs/react". Removed in @aomi-labs/widget 4.0. */
export const formatAddress: typeof aomiReact.formatAddress =
  aomiReact.formatAddress;
/** @deprecated Import from "@aomi-labs/react". Removed in @aomi-labs/widget 4.0. */
export const getChainInfo: typeof aomiReact.getChainInfo =
  aomiReact.getChainInfo;
/** @deprecated Import from "@aomi-labs/react". Removed in @aomi-labs/widget 4.0. */
export const getNetworkName: typeof aomiReact.getNetworkName =
  aomiReact.getNetworkName;
/** @deprecated Import from "@aomi-labs/react". Removed in @aomi-labs/widget 4.0. */
export const SUPPORTED_CHAINS: typeof aomiReact.SUPPORTED_CHAINS =
  aomiReact.SUPPORTED_CHAINS;
/** @deprecated Import from "@aomi-labs/react". Removed in @aomi-labs/widget 4.0. */
export const ExtUserProvider: typeof aomiReact.ExtUserProvider =
  aomiReact.ExtUserProvider;
/** @deprecated Import from "@aomi-labs/react". Removed in @aomi-labs/widget 4.0. */
export const useUser: typeof aomiReact.useUser = aomiReact.useUser;
/** @deprecated Import from "@aomi-labs/react". Removed in @aomi-labs/widget 4.0. */
export const UserState: typeof aomiReact.UserState = aomiReact.UserState;
/** @deprecated Import from "@aomi-labs/react". Removed in @aomi-labs/widget 4.0. */
export type UserState = aomiReact.UserState;
/** @deprecated Import from "@aomi-labs/client". Removed in @aomi-labs/widget 4.0. */
export const arc: typeof aomiClient.arc = aomiClient.arc;
/** @deprecated Import from "@aomi-labs/client". Removed in @aomi-labs/widget 4.0. */
export const arcTestnet: typeof aomiClient.arcTestnet = aomiClient.arcTestnet;
/** @deprecated Import from "@aomi-labs/client". Removed in @aomi-labs/widget 4.0. */
export const megaeth: typeof aomiClient.megaeth = aomiClient.megaeth;
/** @deprecated Import from "@aomi-labs/client". Removed in @aomi-labs/widget 4.0. */
export const monad: typeof aomiClient.monad = aomiClient.monad;
/** @deprecated Import from "@aomi-labs/client". Removed in @aomi-labs/widget 4.0. */
export const monadTestnet: typeof aomiClient.monadTestnet =
  aomiClient.monadTestnet;
/** @deprecated Import from "@aomi-labs/client". Removed in @aomi-labs/widget 4.0. */
export const robinhood: typeof aomiClient.robinhood = aomiClient.robinhood;
