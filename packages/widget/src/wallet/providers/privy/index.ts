"use client";

import * as auth from "@privy-io/react-auth";
import * as solana from "@privy-io/react-auth/solana";
import { privyAuth as widgetPrivyAuth } from "@/frame/widget-auth";
import { setPrivySdk } from "./privy-sdk";
import { registerAomiPrivyWalletProvider } from "./privy-plugin";

// This entry loads Privy eagerly for hosts that compose AomiFrame themselves.
// AomiWidget's `auth` prop loads the same plugin lazily without it.
setPrivySdk({ auth, solana });
registerAomiPrivyWalletProvider();

export {
  AomiPrivyProvider,
  type AomiPrivyProviderProps,
} from "./privy-provider";
export { privyPlugin, registerAomiPrivyWalletProvider } from "./privy-plugin";
export type { PrivyAuthOptions } from "@/frame/widget-auth";

/** @deprecated Import privyAuth from "@aomi-labs/widget". Removed in @aomi-labs/widget 4.0. */
export const privyAuth = widgetPrivyAuth;
