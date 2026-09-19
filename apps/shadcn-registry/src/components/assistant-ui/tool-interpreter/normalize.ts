import { getChainInfo, SUPPORTED_CHAINS } from "@aomi-labs/react";

import type { FactRole, FactSource, ToolFact } from "./types";

export const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;

export const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

export const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

export const asInteger = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};

export const humanize = (value: string): string => {
  const readable = value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  if (!readable) return "Tool";
  return readable.charAt(0).toUpperCase() + readable.slice(1);
};

export const uniqueFacts = (facts: ToolFact[]): ToolFact[] => {
  const seen = new Set<string>();
  return facts.filter((fact) => {
    const key = `${fact.kind}:${fact.role ?? ""}:${fact.label ?? fact.value}`;
    const normalized = key.toLowerCase();
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
};

const normalizeChainLabel = (value: string): string =>
  value.toLowerCase().replace(/[_-]+/g, " ").trim();

const chainInfoFromName = (name: string | undefined) => {
  if (!name) return undefined;
  const normalized = normalizeChainLabel(name);
  return SUPPORTED_CHAINS.find(
    (chain) =>
      normalizeChainLabel(chain.name) === normalized ||
      chain.ticker.toLowerCase() === normalized,
  );
};

export const chainFact = (
  chainId: unknown,
  chainName?: unknown,
  source: FactSource = "result",
): ToolFact | null => {
  const id = asNumber(chainId);
  const name = asString(chainName);
  const chain = id != null ? getChainInfo(id) : chainInfoFromName(name);
  const resolvedId = chain?.id ?? id;
  if (resolvedId == null && !name) return null;

  return {
    kind: "chain",
    value: resolvedId != null ? String(resolvedId) : (name ?? ""),
    label: chain?.name ?? (name ? humanize(name) : `chain ${id}`),
    source,
  };
};

export const chainFactFromRecord = (
  record: Record<string, unknown> | null | undefined,
  source: FactSource = "result",
): ToolFact | null => {
  if (!record) return null;
  return chainFact(
    record.chain_id,
    record.chain_name ?? record.chain ?? record.network,
    source,
  );
};

/** Resolve an explicit chain name embedded in a model-authored tool topic.
 * Longest names win, so "Base Sepolia" is not reduced to "Base". Tickers are
 * intentionally excluded because token symbols such as ETH are ambiguous. */
export const chainFactFromText = (
  value: string,
  source: FactSource = "label",
): ToolFact | null => {
  const searchable = ` ${value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
  const chains = [...SUPPORTED_CHAINS].sort(
    (left, right) => right.name.length - left.name.length,
  );
  const chain = chains.find((candidate) => {
    const name = candidate.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    return name.length > 0 && searchable.includes(` ${name} `);
  });
  return chain ? chainFact(chain.id, chain.name, source) : null;
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const normalizeAddress = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const lower = value.toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(lower) ? lower : null;
};

export const addressFact = (
  value: unknown,
  role: FactRole,
  source: FactSource = "result",
): ToolFact | null => {
  const address = normalizeAddress(value);
  if (!address) return null;
  return {
    kind: "address",
    role: address === ZERO_ADDRESS ? "null" : role,
    value: address,
    source,
  };
};

export const tokenFact = (
  symbol: unknown,
  source: FactSource = "result",
): ToolFact | null => {
  const value = asString(symbol);
  return value ? { kind: "token", value, source } : null;
};

export const amountFact = (
  value: unknown,
  unit?: string,
  source: FactSource = "result",
): ToolFact | null => {
  const raw =
    typeof value === "bigint"
      ? value.toString()
      : typeof value === "number" && Number.isFinite(value)
        ? String(value)
        : asString(value);
  if (!raw) return null;
  return {
    kind: "amount",
    value: raw,
    label: unit ? `${raw} ${unit}` : raw,
    source,
  };
};

export const statusFact = (
  value: unknown,
  source: FactSource = "result",
): ToolFact | null => {
  if (value === true) return { kind: "status", value: "success", source };
  if (value === false) return { kind: "status", value: "failed", source };
  const raw = asString(value);
  if (!raw) return null;
  const normalized = raw.toLowerCase().replace(/[_-]+/g, " ");
  if (normalized === "pending approval") {
    return { kind: "status", value: "pending_approval", source };
  }
  if (normalized.includes("pending")) {
    return { kind: "status", value: "pending", source };
  }
  if (normalized.includes("queued")) {
    return { kind: "status", value: "queued", source };
  }
  if (normalized.includes("success") || normalized.includes("complete")) {
    return { kind: "status", value: "success", source };
  }
  if (normalized.includes("fail") || normalized.includes("error")) {
    return { kind: "status", value: "failed", source };
  }
  if (normalized.includes("revoked")) {
    return { kind: "status", value: "revoked", source };
  }
  return { kind: "status", value: raw, label: humanize(raw), source };
};

export const selectorFact = (
  value: unknown,
  label?: string,
  source: FactSource = "decoded",
): ToolFact | null => {
  const selector =
    typeof value === "string" && value.startsWith("0x") && value.length >= 10
      ? value.slice(0, 10).toLowerCase()
      : null;
  return selector ? { kind: "selector", value: selector, label, source } : null;
};

export const calldataWord = (input: string, index: number): string | null => {
  const start = 10 + index * 64;
  const word = input.slice(start, start + 64);
  return word.length === 64 ? word : null;
};

export const addressFromWord = (word: string | null): string | null => {
  if (!word) return null;
  return normalizeAddress(`0x${word.slice(24)}`);
};

export const bigintFromWord = (word: string | null): string | null => {
  if (!word) return null;
  try {
    return BigInt(`0x${word}`).toString();
  } catch {
    return null;
  }
};

export const decodedValue = (result: Record<string, unknown>): unknown => {
  const decodedRoot = asRecord(result.result_decoded);
  const decoded = asRecord(decodedRoot?.decoded);
  return decoded?.decoded;
};

export const topicTokenFact = (topic: string): ToolFact | null => {
  const matches = topic.match(/\b[A-Z][A-Z0-9]{1,9}\b/g);
  const ignored = new Set(["URL", "USD"]);
  const token = matches?.find((match) => !ignored.has(match));
  return token ? { kind: "token", value: token, source: "label" } : null;
};

export const hostnameFromUrl = (urlText: string): string | null => {
  try {
    return new URL(urlText).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
};
