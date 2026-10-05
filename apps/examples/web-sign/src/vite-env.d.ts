/// <reference types="vite/client" />

import type { EIP1193Provider } from "viem";

declare global {
  interface ImportMetaEnv {
    readonly VITE_AOMI_BASE_URL?: string;
    readonly VITE_AOMI_APPLICATION_ID?: string;
    readonly VITE_ALLOWED_TARGETS?: string;
  }

  interface Window {
    /** Injected EIP-1193 wallet such as MetaMask, Rabby, or Coinbase Wallet. */
    ethereum?: EIP1193Provider;
  }
}
