"use client";

import "@aomi-labs/widget-lib/providers/privy";
import type { ReactNode } from "react";
import type { Chain } from "viem";
import {
  arbitrum,
  base,
  linea,
  lineaSepolia,
  mainnet,
  optimism,
  polygon,
  sepolia,
} from "wagmi/chains";
import {
  AomiWalletKitProvider,
  arc,
  arcTestnet,
  megaeth,
} from "@aomi-labs/widget-lib";

const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const walletConnectProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ||
  process.env.NEXT_PUBLIC_PROJECT_ID;

const networks = [
  mainnet,
  arbitrum,
  optimism,
  base,
  polygon,
  sepolia,
  linea,
  lineaSepolia,
  megaeth,
  arc,
  arcTestnet,
] as const satisfies readonly [Chain, ...Chain[]];
const solanaNetworks = [
  {
    id: "solana-devnet",
    label: "Solana Devnet",
    cluster: "solana:devnet",
    rpcHttpUrl:
      process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL ??
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
      "https://api.devnet.solana.com",
    rpcWsUrl:
      process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC_WS_URL ??
      process.env.NEXT_PUBLIC_SOLANA_RPC_WS_URL,
    isDefault: true,
  },
  {
    id: "solana-mainnet",
    label: "Solana",
    cluster: "solana:mainnet",
    rpcHttpUrl:
      process.env.NEXT_PUBLIC_SOLANA_MAINNET_RPC_URL ??
      "https://api.mainnet-beta.solana.com",
    rpcWsUrl: process.env.NEXT_PUBLIC_SOLANA_MAINNET_RPC_WS_URL,
  },
  {
    id: "solana-testnet",
    label: "Solana Testnet",
    cluster: "solana:testnet",
    rpcHttpUrl:
      process.env.NEXT_PUBLIC_SOLANA_TESTNET_RPC_URL ??
      "https://api.testnet.solana.com",
    rpcWsUrl: process.env.NEXT_PUBLIC_SOLANA_TESTNET_RPC_WS_URL,
  },
] as const;

export function LandingPrivyProvider({ children }: { children: ReactNode }) {
  return (
    <AomiWalletKitProvider
      preset="privy"
      auth={{ provider: "privy", methods: ["email", "google", "wallet"] }}
      providers={{
        privy: {
          appId: privyAppId,
          appName: "Aomi Labs",
        },
      }}
      wallets={{
        evm: {
          chains: networks,
          walletConnectProjectId,
          appName: "Aomi Labs",
        },
        solana: {
          networks: solanaNetworks,
          preferDirectSend: true,
        },
      }}
    >
      {children}
    </AomiWalletKitProvider>
  );
}
