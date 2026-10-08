"use client";

import type { AccountRuntime } from "./types";

export const DISABLED_ACCOUNT_RUNTIME: AccountRuntime = {
  status: "disabled",
  linkedAccounts: [],
  wallets: [],
  refresh: async () => undefined,
};
