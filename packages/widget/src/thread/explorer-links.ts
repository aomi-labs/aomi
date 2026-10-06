import { CHAINS_BY_ID } from "@aomi-labs/client";
import bs58 from "bs58";

export type IdentifierKind = "address" | "token" | "tx" | "block";
type SolanaCluster = "mainnet-beta" | "devnet" | "testnet";
type Chain = number | SolanaCluster;
type Explorer = { name: string; base: string };

const CLUSTERS: readonly string[] = ["mainnet-beta", "devnet", "testnet"];

// Display fields only; keep Viem's RPC types out of the Markdown renderer.
export const CONFIGURED_EVM_EXPLORERS: Record<number, Explorer> =
  Object.fromEntries(
    Object.entries(
      CHAINS_BY_ID as Record<
        number,
        { name: string; blockExplorers?: { default: { url: string } } }
      >,
    )
      .filter(([id, chain]) => id !== "31337" && chain.blockExplorers)
      .map(([id, chain]) => [
        id,
        { name: chain.name, base: chain.blockExplorers!.default.url },
      ]),
  );

// Explorer-only additions and overrides; they do not enable execution.
// Keep aligned with product-mono `PUBLIC_EXPLORERS`.
export const EVM_EXPLORERS: Record<number, Explorer> = {
  ...CONFIGURED_EVM_EXPLORERS,
  4663: { name: "Robinhood Chain", base: "https://robinscan.io" },
  46630: {
    name: "Robinhood Testnet",
    base: "https://explorer.testnet.chain.robinhood.com",
  },
  143: { name: "Monad", base: "https://monadscan.com" },
  10143: { name: "Monad Testnet", base: "https://testnet.monadscan.com" },
  5042002: { name: "Arc Testnet", base: "https://explorer.testnet.arc.io" },
  2092151908: {
    name: "UniFi Testnet",
    base: "https://testnet-unifi-explorer.puffer.fi",
  },
};

export function validIdentifier(
  identifier: string,
  kind: IdentifierKind,
  solana: boolean,
): boolean {
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

export function explorerUrl(
  chain: Chain,
  kind: IdentifierKind,
  identifier: string,
): string | null {
  const solana = typeof chain === "string";
  if (!validIdentifier(identifier, kind, solana)) return null;
  if (!solana) {
    const explorer = EVM_EXPLORERS[chain];
    return explorer ? `${explorer.base}/${kind}/${identifier}` : null;
  }
  if (chain === "mainnet-beta") {
    return `https://solscan.io/${kind === "address" ? "account" : kind}/${identifier}`;
  }
  const path = kind === "token" ? "address" : kind;
  return `https://explorer.solana.com/${path}/${identifier}?cluster=${chain}`;
}

// The field name types the identifier; a 32-byte hex value alone could be a
// pool ID, order ID or block hash. `null` marks values that must never link.
const FIELDS: Record<string, IdentifierKind | null> = {
  address: "address",
  wallet: "address",
  wallet_address: "address",
  contract_address: "address",
  program_id: "address",
  token_address: "token",
  token_contract: "token",
  token_mint: "token",
  mint: "token",
  transaction_hash: "tx",
  transaction_id: "tx",
  signature: "tx",
  block_hash: "block",
  pool_id: null,
};

type Item = Record<string, unknown>;

/** The source chain an object states: undefined inherits, null blocks. */
function statedChain(item: Item): Chain | null | undefined {
  const evm =
    item.chain_id ?? (item.chain_family === "evm" ? item.chain_ref : undefined);
  const svm =
    item.cluster ?? (item.chain_family === "svm" ? item.chain_ref : undefined);
  if (evm === undefined && svm === undefined) {
    return "chain_id" in item || "cluster" in item || "chain_ref" in item
      ? null
      : undefined;
  }
  if (evm !== undefined && svm !== undefined) return null;
  if (typeof evm === "number" || (typeof evm === "string" && /^\d+$/.test(evm)))
    return Number(evm);
  return typeof svm === "string" && CLUSTERS.includes(svm)
    ? (svm as SolanaCluster)
    : null;
}

/**
 * Explorer links for identifiers in this message's tool results, keyed by
 * identifier. Chain and type come from the result itself, never the active
 * wallet or the identifier's shape. A transaction links only when the host
 * attached the same public `transaction_url`, because local forks reuse
 * public chain IDs. Conflicting or pool-typed values map to null.
 */
export function toolExplorerLinks(
  content: readonly unknown[],
): Map<string, string | null> {
  const links = new Map<string, string | null>();
  const add = (identifier: string, url: string | null) => {
    const previous = links.get(identifier);
    links.set(
      identifier,
      previous === undefined || previous === url ? url : null,
    );
  };
  const visit = (value: unknown, inherited: Chain | null, depth: number) => {
    if (depth > 12 || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const child of value) visit(child, inherited, depth + 1);
      return;
    }
    const item = value as Item;
    const stated = statedChain(item);
    const chain = stated === undefined ? inherited : stated;
    for (const [field, kind] of Object.entries(FIELDS)) {
      const identifier = item[field];
      if (typeof identifier !== "string") continue;
      if (kind === null) {
        add(identifier, null);
        continue;
      }
      if (chain === null) continue;
      const url = explorerUrl(chain, kind, identifier);
      if (!url || (kind === "tx" && item.transaction_url !== url)) continue;
      add(identifier, url);
    }
    for (const child of Object.values(item)) visit(child, chain, depth + 1);
  };
  for (const part of content) {
    if ((part as Item | null)?.type !== "tool-call") continue;
    let result = (part as Item).result;
    if (typeof result === "string") {
      try {
        result = JSON.parse(result);
      } catch {
        continue;
      }
    }
    visit(result, null, 0);
  }
  return links;
}

type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
};

const SKIPPED_NODES = [
  "link",
  "linkReference",
  "code",
  "html",
  "image",
  "imageReference",
];
// A whole hex or base58 token; never a prefix of a longer word, URL or path.
const IDENTIFIER =
  /(?<![\w/.\-])(?:0x[\da-zA-Z]+|[1-9A-HJ-NP-Za-km-z]{32,88})(?![\w]|\.[\da-zA-Z])/g;

/** Link identifiers the model left bare; authored links and code blocks stay. */
export function remarkExplorerLinks(links: ReadonlyMap<string, string | null>) {
  const visit = (node: MarkdownNode) => {
    if (SKIPPED_NODES.includes(node.type) || !node.children) return;
    node.children = node.children.flatMap((child): MarkdownNode[] => {
      if (child.type === "inlineCode") {
        const url = links.get(child.value ?? "");
        return url ? [{ type: "link", url, children: [child] }] : [child];
      }
      if (child.type !== "text") {
        visit(child);
        return [child];
      }
      const text = child.value ?? "";
      const parts: MarkdownNode[] = [];
      let offset = 0;
      for (const match of text.matchAll(IDENTIFIER)) {
        const url = links.get(match[0]);
        if (!url) continue;
        if (match.index > offset)
          parts.push({ type: "text", value: text.slice(offset, match.index) });
        parts.push({
          type: "link",
          url,
          children: [{ type: "text", value: match[0] }],
        });
        offset = match.index + match[0].length;
      }
      if (!offset) return [child];
      if (offset < text.length)
        parts.push({ type: "text", value: text.slice(offset) });
      return parts;
    });
  };
  return (tree: MarkdownNode) => visit(tree);
}
