import {
  mainnet,
  arbitrum,
  optimism,
  base,
  polygon,
  sepolia,
  linea,
  lineaSepolia,
} from "wagmi/chains";
import {
  Environment,
  type TOAuthMethod,
  type TExternalWallet,
} from "@getpara/react-sdk";
import { defineChain, http, type Chain, type Transport } from "viem";
import {
  arc,
  arcTestnet,
  megaeth,
  monad,
  monadTestnet,
  robinhood,
} from "../../../shadcn-registry/src";

export const useAnvilForWallet =
  process.env.NEXT_PUBLIC_ANVIL_FOR_WALLET === "true";
export const LOCALHOST_CHAIN_ID = 31337;

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
});

export const paraApiKey =
  process.env.NEXT_PUBLIC_PARA_API_KEY ?? "missing-para-api-key";

export const walletConnectProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ??
  process.env.NEXT_PUBLIC_PROJECT_ID ??
  "missing-walletconnect-project-id";

export const paraEnvironment =
  (process.env.NEXT_PUBLIC_PARA_ENVIRONMENT as Environment | undefined) ??
  Environment.BETA;

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

export const networks = (
  useAnvilForWallet ? [localhost, ...defaultNetworks] : [...defaultNetworks]
) as readonly [Chain, ...Chain[]];

export const transports = Object.fromEntries(
  networks.map((network) => [
    network.id,
    http(network.rpcUrls.default.http[0]),
  ]),
) as Record<number, Transport>;

export const externalWallets: TExternalWallet[] = [
  "WALLETCONNECT",
  "METAMASK",
  "COINBASE",
  "RAINBOW",
  "RABBY",
];

export const oAuthMethods: TOAuthMethod[] = ["GOOGLE"];
