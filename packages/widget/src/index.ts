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
  type ParaAuthOptions,
  type PrivyAuthOptions,
  type WalletPresentationConfig,
} from "./frame/aomi-widget";
export type {
  AomiRoutingConfig,
  AomiRoutingTarget,
  DirectRoutingAgent,
} from "./controls/routing";
export { preloadWalletProvider } from "./wallet/providers/provider-registry";
/** Merge Tailwind classes, aware of the Aomi theme's names. */
export { cn } from "./lib/cn";
