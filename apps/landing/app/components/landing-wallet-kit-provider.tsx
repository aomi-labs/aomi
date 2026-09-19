"use client";

import "@aomi-labs/widget-lib/providers/para";
import { useEffect, useState, type ReactNode } from "react";
import { defineChain, type Chain } from "viem";
import { useAccount, useSwitchChain } from "wagmi";
import {
  AomiWalletKitProvider,
  arc,
  arcTestnet,
  isFullTestnet,
  megaeth,
  monad,
  monadTestnet,
  robinhood,
} from "@aomi-labs/widget-lib";
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

const useAnvilForWallet = process.env.NEXT_PUBLIC_ANVIL_FOR_WALLET === "true";
const LOCALHOST_CHAIN_ID = 31337;

const walletConnectProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ||
  process.env.NEXT_PUBLIC_PROJECT_ID;
const paraApiKey = process.env.NEXT_PUBLIC_PARA_API_KEY;
const paraEnvironment: "PROD" | "BETA" =
  process.env.NEXT_PUBLIC_PARA_ENVIRONMENT === "PROD" ? "PROD" : "BETA";

const localhost = defineChain({
  id: 31337,
  name: "Localhost",
  nativeCurrency: {
    decimals: 18,
    name: "Ether",
    symbol: "ETH",
  },
  rpcUrls: {
    default: {
      http: ["http://127.0.0.1:8545"],
    },
  },
  blockExplorers: {
    default: {
      name: "Local",
      url: "http://127.0.0.1:8545",
    },
  },
});

const defaultNetworks = [
  mainnet,
  arbitrum,
  optimism,
  base,
  polygon,
  sepolia,
  linea,
  lineaSepolia,
  monad,
  monadTestnet,
  robinhood,
  megaeth,
  arc,
  arcTestnet,
] as const;

const networks = (
  useAnvilForWallet ? [localhost, ...defaultNetworks] : [...defaultNetworks]
) as readonly [Chain, ...Chain[]];

const evmWallets = [
  "walletconnect",
  "metamask",
  "coinbase",
  "rainbow",
  "rabby",
] as const;

const enabledEvmWallets = walletConnectProjectId
  ? evmWallets
  : evmWallets.filter((wallet) => wallet !== "walletconnect");

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
  },
  {
    id: "solana-mainnet",
    label: "Solana",
    cluster: "solana:mainnet",
    rpcHttpUrl:
      process.env.NEXT_PUBLIC_SOLANA_MAINNET_RPC_URL ??
      "https://api.mainnet-beta.solana.com",
    rpcWsUrl: process.env.NEXT_PUBLIC_SOLANA_MAINNET_RPC_WS_URL,
    isDefault: true,
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

function DevAnvilRpcHook({ children }: { children: ReactNode }) {
  const { isConnected, chainId, connector } = useAccount();
  const { switchChain } = useSwitchChain();

  useEffect(() => {
    if (isFullTestnet()) return;
    if (!useAnvilForWallet) return;
    if (!isConnected || chainId === LOCALHOST_CHAIN_ID) return;

    const switchToLocalhost = async () => {
      try {
        const provider = await connector?.getProvider();
        if (provider && typeof provider === "object" && "request" in provider) {
          const ethProvider = provider as {
            request: (args: {
              method: string;
              params: unknown[];
            }) => Promise<unknown>;
          };
          try {
            await ethProvider.request({
              method: "wallet_addEthereumChain",
              params: [
                {
                  chainId: `0x${LOCALHOST_CHAIN_ID.toString(16)}`,
                  chainName: "Localhost",
                  nativeCurrency: {
                    name: "Ether",
                    symbol: "ETH",
                    decimals: 18,
                  },
                  rpcUrls: ["http://127.0.0.1:8545"],
                },
              ],
            });
          } catch {
            // Chain may already be configured in the wallet.
          }
        }

        switchChain({ chainId: LOCALHOST_CHAIN_ID });
      } catch (error) {
        console.error("[DevAnvilRpcHook] Failed to switch network:", error);
      }
    };

    void switchToLocalhost();
  }, [isConnected, chainId, connector, switchChain]);

  return <>{children}</>;
}

export function LandingWalletKitProvider({
  children,
}: {
  children: ReactNode;
}) {
  // The wallet providers are browser-only: they read `window` and
  // wagmi hooks throw under SSR/prerender (`useConfig must be used within
  // WagmiProvider`). Mount the wallet stack only after hydration so static
  // export / SSR never renders it. Server and first client render both produce
  // `null`, so there's no hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return null;
  }

  return (
    <AomiWalletKitProvider
      preset="wallets-only"
      auth={{ provider: "para", methods: ["google", "email", "wallet"] }}
      providers={{
        para: {
          apiKey: paraApiKey,
          environment: paraEnvironment,
          appName: "Aomi Labs",
          appDescription: "Interactive Aomi widget demo",
          appUrl:
            typeof window !== "undefined"
              ? window.location.origin
              : "https://aomi.dev",
        },
      }}
      execution={{
        aa: "optional",
      }}
      wallets={{
        evm: {
          chains: networks,
          wallets: enabledEvmWallets,
          walletConnectProjectId,
          appName: "Aomi Labs",
        },
        solana: {
          networks: solanaNetworks,
          preferDirectSend: true,
        },
      }}
    >
      <DevAnvilRpcHook>{children}</DevAnvilRpcHook>
    </AomiWalletKitProvider>
  );
}
