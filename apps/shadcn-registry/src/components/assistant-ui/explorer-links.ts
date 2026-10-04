import { CHAINS_BY_ID } from "@aomi-labs/client";
import bs58 from "bs58";

export type IdentifierKind = "address" | "token" | "tx" | "block" | "pool";
export type SolanaCluster = "mainnet-beta" | "devnet" | "testnet" | "localnet";
export type IdentifierReference = {
  identifier: string;
  chain: number | SolanaCluster | undefined;
  kind: IdentifierKind;
  provenance: "research" | "public-receipt" | "local" | "simulation";
};

type ConfiguredChain = {
  name: string;
  blockExplorers?: { default: { url: string } };
};
type Explorer = { name: string; base: string };
// Read only the display fields; do not carry Viem's execution/RPC types into
// the Markdown renderer or its published declarations.
export const CONFIGURED_EVM_EXPLORERS: Record<number, Explorer> =
  Object.fromEntries(
    Object.entries(CHAINS_BY_ID as Record<number, ConfiguredChain>)
      .filter(([id, chain]) => id !== "31337" && chain.blockExplorers?.default)
      .map(([id, chain]) => [
        id,
        { name: chain.name, base: chain.blockExplorers!.default.url },
      ]),
  );

// Use the existing chain registry; unresolved explorer providers need an
// authoritative mapping before identifiers can link to them.
export const EVM_EXPLORERS = CONFIGURED_EVM_EXPLORERS;

export function validIdentifier(
  identifier: string,
  kind: IdentifierKind,
  solana = false,
): boolean {
  if (kind === "pool") return false;
  if (kind === "block") {
    return (
      /^(?:0|[1-9][0-9]*)$/.test(identifier) ||
      (!solana && /^0x[a-fA-F0-9]{64}$/.test(identifier))
    );
  }
  if (!solana) {
    return (kind === "tx" ? /^0x[a-fA-F0-9]{64}$/ : /^0x[a-fA-F0-9]{40}$/).test(
      identifier,
    );
  }
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,88}$/.test(identifier)) return false;
  return bs58.decode(identifier).length === (kind === "tx" ? 64 : 32);
}

/** A chain/type association is required; length is only validation. */
export function identifierUrl(reference: IdentifierReference): string | null {
  const { identifier, chain, kind, provenance } = reference;
  if (
    chain === undefined ||
    kind === "pool" ||
    provenance === "local" ||
    provenance === "simulation"
  )
    return null;
  if (!validIdentifier(identifier, kind, typeof chain === "string"))
    return null;
  if (typeof chain === "number") {
    const explorer = EVM_EXPLORERS[chain];
    return explorer ? `${explorer.base}/${kind}/${identifier}` : null;
  }
  if (chain === "localnet") return null;
  if (chain === "mainnet-beta") {
    const path = kind === "address" ? "account" : kind;
    return `https://solscan.io/${path}/${identifier}`;
  }
  const path = kind === "token" ? "address" : kind;
  return `https://explorer.solana.com/${path}/${identifier}?cluster=${chain}`;
}

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : null;

const IDENTIFIER_FIELDS: Record<string, IdentifierKind> = {
  address: "address",
  wallet_address: "address",
  seller_wallet: "address",
  contract_address: "address",
  program_id: "address",
  token_address: "token",
  token_contract: "token",
  token_mint: "token",
  mint: "token",
  transaction_hash: "tx",
  transaction_id: "tx",
  signature: "tx",
  transaction_signature: "tx",
  block_number: "block",
  block_hash: "block",
  slot: "block",
  block_slot: "block",
  pool_id: "pool",
};

/** Consume source associations in this assistant message's tool results only.
 * No active wallet, tool arguments, arbitrary `hash` fields, or prose guesses.
 * Receipt hashes need explicit public provenance, not merely a familiar chain.
 */
export function toolIdentifierReferences(
  content: readonly unknown[],
): IdentifierReference[] {
  const references: IdentifierReference[] = [];
  function visit(
    value: unknown,
    parentChain?: number | SolanaCluster,
    blocked = false,
    depth = 0,
  ) {
    if (depth > 12) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, parentChain, blocked, depth + 1);
      return;
    }
    const item = record(value);
    if (!item) return;
    const local =
      blocked ||
      item.local === true ||
      item.is_local === true ||
      item.fork === true ||
      item.simulation === true ||
      ["local", "simulation", "fork"].includes(String(item.provenance));
    // Explicit unknown chain overrides inheritance; never inherit through it.
    const wireChain =
      item.chain_family === "evm" &&
      typeof item.chain_ref === "string" &&
      /^[1-9][0-9]*$/.test(item.chain_ref)
        ? Number(item.chain_ref)
        : undefined;
    const wireCluster =
      item.chain_family === "svm" ? item.chain_ref : undefined;
    const sourceChain = item.chain_id ?? wireChain;
    const sourceCluster = item.cluster ?? wireCluster;
    const hasChain =
      "chain_id" in item || "cluster" in item || "chain_ref" in item;
    const chain =
      sourceChain !== undefined && sourceCluster !== undefined
        ? undefined
        : typeof sourceChain === "number" &&
            Number.isSafeInteger(sourceChain) &&
            sourceCluster === undefined
          ? sourceChain
          : ["mainnet-beta", "devnet", "testnet", "localnet"].includes(
                String(sourceCluster),
              )
            ? (sourceCluster as SolanaCluster)
            : hasChain
              ? undefined
              : parentChain;
    for (const [field, kind] of Object.entries(IDENTIFIER_FIELDS)) {
      const raw = item[field];
      const identifier =
        typeof raw === "string"
          ? raw
          : kind === "block" &&
              typeof raw === "number" &&
              Number.isSafeInteger(raw)
            ? String(raw)
            : null;
      if (identifier === null || (chain === undefined && kind !== "pool"))
        continue;
      const publicReceipt =
        item.state === "confirmed" &&
        (item.provenance === "public-receipt" ||
          (kind === "tx" &&
            item.transaction_url ===
              identifierUrl({
                identifier,
                chain,
                kind,
                provenance: "research",
              })));
      const publicResearch =
        item.provenance === "research" && item.public === true;
      if (kind === "tx" && !local && !publicReceipt && !publicResearch)
        continue;
      references.push({
        identifier,
        chain,
        kind,
        provenance: local
          ? "local"
          : publicReceipt
            ? "public-receipt"
            : "research",
      });
    }
    for (const child of Object.values(item))
      visit(child, chain, local, depth + 1);
  }
  for (const part of content) {
    const item = record(part);
    if (item?.type !== "tool-call") continue;
    let result = item.result;
    if (typeof result === "string") {
      try {
        result = JSON.parse(result);
      } catch {
        continue;
      }
    }
    visit(result);
  }
  return references;
}
