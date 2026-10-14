import { shortAddress } from "@aomi-labs/client";

/** @deprecated Use `shortAddress` from "@aomi-labs/client". Removed in @aomi-labs/react 1.0. */
export const formatAddress = (addr?: string): string =>
  addr ? shortAddress(addr) : "Connect Wallet";
