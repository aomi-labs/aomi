import {
  createPublicClient,
  defineChain,
  http,
  recoverMessageAddress,
  verifyMessage as verifyEoaMessage,
  type Chain,
  type PublicClient,
} from "viem";
import {
  arbitrum,
  arcTestnet,
  base,
  baseSepolia,
  linea,
  lineaSepolia,
  mainnet,
  megaeth,
  optimism,
  polygon,
  sepolia,
} from "viem/chains";
import { observeAccountDiagnostic } from "../observability";

export async function verifySiweMessage(input: {
  message: string;
  signature: string;
  address: string;
  chainId?: number | null;
}): Promise<boolean> {
  let eoaError: unknown;
  try {
    const eoaOk = await verifyEoaMessage({
      address: input.address as `0x${string}`,
      message: input.message,
      signature: input.signature as `0x${string}`,
    });
    if (eoaOk) return true;
  } catch (error) {
    eoaError = error;
    // Fall through to public-client verification for smart accounts.
  }

  const chainId = input.chainId ?? parseSiweChainId(input.message);
  if (!chainId) {
    await observeInvalidSiweMessage(input, {
      eoaError,
      reason: "missing_chain",
    });
    return false;
  }
  const client = publicClientForChain(chainId);
  if (!client) {
    await observeInvalidSiweMessage(input, {
      eoaError,
      reason: "unsupported_chain",
    });
    return false;
  }
  try {
    const smartAccountOk = await client.verifyMessage({
      address: input.address as `0x${string}`,
      message: input.message,
      signature: input.signature as `0x${string}`,
    });
    if (smartAccountOk) return true;
  } catch (error) {
    await observeInvalidSiweMessage(input, {
      eoaError,
      smartAccountError: error,
      reason: "signature_mismatch",
    });
    return false;
  }
  await observeInvalidSiweMessage(input, {
    eoaError,
    reason: "signature_mismatch",
  });
  return false;
}

export async function verifyEoaSiweMessage(input: {
  message: string;
  signature: string;
  address: string;
}): Promise<boolean> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(input.address)) return false;
  if (!/^0x[0-9a-fA-F]+$/.test(input.signature)) return false;
  try {
    return await verifyEoaMessage({
      address: input.address as `0x${string}`,
      message: input.message,
      signature: input.signature as `0x${string}`,
    });
  } catch {
    return false;
  }
}

const VERIFY_CHAINS: readonly Chain[] = [
  mainnet,
  arbitrum,
  optimism,
  base,
  baseSepolia,
  polygon,
  sepolia,
  linea,
  lineaSepolia,
  megaeth,
  // This workspace's viem version does not yet export Arc Mainnet.
  defineChain({
    id: 5042,
    name: "Arc",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: ["https://rpc.mainnet.arc.io"] } },
    blockExplorers: {
      default: { name: "Arc Explorer", url: "https://explorer.arc.io" },
    },
  }),
  arcTestnet,
];

const publicClients = new Map<number, PublicClient>();

// Per-chain RPC for the smart-account (EIP-1271 / ERC-6492) check, which does a
// heavy *deployless* `eth_call` (it counterfactually deploys the wallet, then
// calls `isValidSignature`). Keyless public RPCs — notably viem's mainnet
// default `eth.merkle.io` — frequently time out on this call, which makes
// Coinbase Smart Wallet / Base Account SIWE logins hang (the EOA path
// short-circuits, so MetaMask/Rabby are unaffected). Resolution order per chain:
// an explicit `*_RPC_URL` override, then the shared `ALCHEMY_API_KEY` the
// wallet/AA stack already uses (no new env var), then the public default.
const RPC_ENV_BY_CHAIN: Record<number, readonly string[]> = {
  [mainnet.id]: ["MAINNET_RPC_URL", "ETH_RPC_URL"],
  [base.id]: ["BASE_RPC_URL"],
  [baseSepolia.id]: ["BASE_SEPOLIA_RPC_URL"],
  [arbitrum.id]: ["ARBITRUM_RPC_URL"],
  [optimism.id]: ["OPTIMISM_RPC_URL"],
  [polygon.id]: ["POLYGON_RPC_URL"],
  [sepolia.id]: ["SEPOLIA_RPC_URL"],
  [linea.id]: ["LINEA_RPC_URL"],
  [lineaSepolia.id]: ["LINEA_SEPOLIA_RPC_URL"],
  [megaeth.id]: ["MEGAETH_RPC_URL"],
};

// Alchemy network slugs, mirroring ALCHEMY_CHAIN_SLUGS in `@aomi-labs/client`
// (kept local to avoid a client dependency in this auth package).
const ALCHEMY_SLUG_BY_CHAIN: Record<number, string> = {
  [mainnet.id]: "eth-mainnet",
  [sepolia.id]: "eth-sepolia",
  [arbitrum.id]: "arb-mainnet",
  [optimism.id]: "opt-mainnet",
  [base.id]: "base-mainnet",
  [baseSepolia.id]: "base-sepolia",
  [polygon.id]: "polygon-mainnet",
  [linea.id]: "linea-mainnet",
  [lineaSepolia.id]: "linea-sepolia",
  [megaeth.id]: "megaeth-mainnet",
};

// Shared public default, mirrors DEFAULT_ALCHEMY_API_KEY in `@aomi-labs/client`
// so the on-chain check still resolves when neither Alchemy env var is set.
const DEFAULT_ALCHEMY_API_KEY = "72eIUle_3rfixX00QJVwk";

function alchemyApiKey(): string {
  return (
    process.env.ALCHEMY_API_KEY?.trim() ||
    process.env.NEXT_PUBLIC_ALCHEMY_API_KEY?.trim() ||
    DEFAULT_ALCHEMY_API_KEY
  );
}

function rpcUrlForChain(chain: Chain): string | undefined {
  for (const name of RPC_ENV_BY_CHAIN[chain.id] ?? []) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  const slug = ALCHEMY_SLUG_BY_CHAIN[chain.id];
  if (slug) return `https://${slug}.g.alchemy.com/v2/${alchemyApiKey()}`;
  // Last resort: the chain's default public RPC.
  return chain.rpcUrls.default.http[0];
}

function publicClientForChain(chainId: number): PublicClient | null {
  const existing = publicClients.get(chainId);
  if (existing) return existing;
  const chain = VERIFY_CHAINS.find((candidate) => candidate.id === chainId);
  if (!chain) return null;
  const client = createPublicClient({
    chain,
    // Bounded timeout + a single retry so an unreachable/slow RPC fails fast
    // (a ~20s 401) instead of stalling the sign-in spinner indefinitely.
    transport: http(rpcUrlForChain(chain), { timeout: 10_000, retryCount: 1 }),
  }) as PublicClient;
  publicClients.set(chainId, client);
  return client;
}

function parseSiweChainId(message: string): number | null {
  const match = message.match(/^Chain ID:\s*(\d+)\s*$/im);
  if (!match) return null;
  const chainId = Number(match[1]);
  return Number.isInteger(chainId) && chainId > 0 ? chainId : null;
}

async function observeInvalidSiweMessage(
  input: {
    message: string;
    signature: string;
    address: string;
    chainId?: number | null;
  },
  details: {
    reason: string;
    eoaError?: unknown;
    smartAccountError?: unknown;
  },
): Promise<void> {
  const recoveredAddress = await recoverSigner(input.message, input.signature);
  const lines = input.message.split(/\r?\n/);
  observeAccountDiagnostic({
    kind: "siwe.signature_mismatch",
    attributes: {
      reason: details.reason,
      expected_address: shortAddress(input.address),
      recovered_address: recoveredAddress
        ? shortAddress(recoveredAddress)
        : null,
      chain_id: input.chainId ?? parseSiweChainId(input.message),
      message_line_count: lines.length,
      message_address_matches:
        lines[1]?.toLowerCase() === input.address.toLowerCase(),
      eoa_error_kind: errorKind(details.eoaError),
      smart_account_error_kind: errorKind(details.smartAccountError),
    },
    context: {
      routeFamily: "/api/auth/[...all]",
      operation: "account.siwe_verify",
      method: "POST",
    },
    response: { status: 401, error: "invalid_siwe_signature" },
  });
}

async function recoverSigner(
  message: string,
  signature: string,
): Promise<string | null> {
  try {
    return await recoverMessageAddress({
      message,
      signature: signature as `0x${string}`,
    });
  } catch {
    return null;
  }
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function errorKind(error: unknown): string | null {
  return error instanceof Error ? error.name.slice(0, 80) : null;
}
