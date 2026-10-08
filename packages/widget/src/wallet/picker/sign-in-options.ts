"use client";

import { createContext } from "react";
import type { AomiWalletOption } from "@/wallet/types";

/** Host-owned provider choices; selecting one does not grant wallet authority. */
export const WalletSignInOptionsContext = createContext<
  readonly (AomiWalletOption & { connect: () => Promise<void> })[]
>([]);
