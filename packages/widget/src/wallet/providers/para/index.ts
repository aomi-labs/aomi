"use client";

import * as react from "@getpara/react-sdk";
import * as wagmi from "@getpara/wagmi-v2-connector";
import "@getpara/react-sdk/styles.css";
import { paraAuth as widgetParaAuth } from "@/frame/widget-auth";
import { setParaSdk } from "./para-sdk";
import { registerAomiParaWalletProvider } from "./para-plugin";

// This entry loads Para eagerly for hosts that compose AomiFrame themselves.
// AomiWidget's `auth` prop loads the same plugin lazily without it.
setParaSdk({ react, wagmi });
registerAomiParaWalletProvider();

export {
  AomiParaPluginProvider,
  type AomiParaPluginProviderProps,
} from "./para-plugin-provider";
export { paraPlugin, registerAomiParaWalletProvider } from "./para-plugin";
export type { ParaAuthOptions } from "@/frame/widget-auth";

/** @deprecated Import paraAuth from "@aomi-labs/widget". Removed in @aomi-labs/widget 4.0. */
export const paraAuth = widgetParaAuth;
