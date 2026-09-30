import {
  CircleDollarSignIcon,
  LandmarkIcon,
  TrendingUpIcon,
} from "lucide-react";

import {
  asInteger,
  asNumber,
  asRecord,
  asString,
  chainFact,
  chainFactFromRecord,
  statusFact,
  tokenFact,
  uniqueFacts,
} from "../normalize";
import type {
  FactSource,
  ToolContext,
  ToolFact,
  ToolOperation,
} from "../types";
import { validResult } from "./shared";
import type { ProtocolAdapter } from "./types";

const MAX_PRICES = 3;
const MAX_PROTOCOLS = 2;

const YIELD_KINDS: Record<string, string> = {
  lend: "Lending",
  lp: "LP",
  stake: "Staking",
  vault: "Vaults",
};

const PROTOCOL_TITLES: Record<string, string> = {
  lookup: "Look up protocol",
  chain_overview: "Scan chain",
  list: "Find protocols",
};

const op = (
  id: string,
  rawLabel: string,
  facts: Array<ToolFact | null>,
  title?: string,
): ToolOperation => ({
  id,
  title,
  facts: uniqueFacts(facts.filter((fact): fact is ToolFact => fact != null)),
  confidence: "high",
  rawLabel,
});

const records = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value
        .map(asRecord)
        .filter((item): item is Record<string, unknown> => item != null)
    : [];

const failedFact = (result: Record<string, unknown> | null): ToolFact | null =>
  result && !validResult(result) ? statusFact("failed") : null;

/** Args name a chain as "base" or "8453"; results carry chain_id/chain_name. */
const argsChainFact = (value: unknown): ToolFact | null => {
  const id = asInteger(value);
  return id != null
    ? chainFact(id, undefined, "args")
    : chainFact(undefined, value, "args");
};

/** "base:0x8335…" and "coingecko:ethereum" read as their token part. */
const requestedTokenLabel = (value: unknown): string | undefined => {
  const token = asString(value)?.split(":").at(-1);
  return token?.startsWith("0x")
    ? `${token.slice(0, 6)}…${token.slice(-4)}`
    : token;
};

const formatUsd = (value: number): string =>
  `$${value.toLocaleString(
    "en-US",
    value >= 1000
      ? { maximumFractionDigits: 0 }
      : value >= 1
        ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
        : { maximumSignificantDigits: 4 },
  )}`;

const formatPercent = (value: number): string =>
  `${value.toLocaleString("en-US", {
    maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2,
  })}%`;

const labelFact = (
  kind: ToolFact["kind"],
  label: string | undefined,
  source: FactSource,
  value = label,
): ToolFact | null => (label && value ? { kind, value, label, source } : null);

const countFact = (count: number, label: string): ToolFact => ({
  kind: "count",
  role: "results",
  value: String(count),
  label,
  source: "result",
});

const matchPrices = ({ rawLabel, parsedArgs, resultRecord }: ToolContext) => {
  const args = asRecord(parsedArgs);
  const result = validResult(resultRecord) ? resultRecord : null;
  const prices = records(result?.prices);
  const unresolved = records(result?.unresolved).length;
  // Resolved prices once they arrive; the requested tokens until then.
  const tokens = prices.length
    ? prices.map((price) => {
        const symbol =
          asString(price.symbol) ?? requestedTokenLabel(price.query);
        const usd = asNumber(price.price_usd);
        return labelFact(
          "token",
          symbol && usd != null ? `${symbol} ${formatUsd(usd)}` : symbol,
          "result",
        );
      })
    : (Array.isArray(args?.tokens) ? args.tokens : []).map((token) =>
        labelFact("token", requestedTokenLabel(token), "args"),
      );

  return op(
    "defillama.prices",
    rawLabel,
    [
      chainFactFromRecord(result) ?? argsChainFact(args?.chain),
      ...tokens.slice(0, MAX_PRICES),
      !prices.length && unresolved
        ? countFact(unresolved, `${unresolved} not found`)
        : null,
      failedFact(resultRecord),
    ],
    args?.at != null ? "Check historical prices" : undefined,
  );
};

const matchYields = ({ rawLabel, parsedArgs, resultRecord }: ToolContext) => {
  const args = asRecord(parsedArgs);
  const result = validResult(resultRecord) ? resultRecord : null;
  const top = records(result?.results)[0];
  const poolLookup = asString(args?.pool_id) != null;
  const kind = asString(result?.kind) ?? asString(args?.kind);
  const topName = asString(top?.protocol) ?? asString(top?.project);
  const apy = asNumber(top?.apy);
  const total = asNumber(result?.total_matches);

  return op(
    "defillama.yields",
    rawLabel,
    [
      chainFactFromRecord(result) ??
        (poolLookup ? chainFactFromRecord(top) : null) ??
        argsChainFact(args?.chain),
      tokenFact(result?.asset, "result") ??
        tokenFact(args?.asset, "args") ??
        (poolLookup ? tokenFact(top?.symbol) : null),
      kind && Object.hasOwn(YIELD_KINDS, kind)
        ? labelFact("category", YIELD_KINDS[kind], "args", kind)
        : null,
      topName && apy != null
        ? labelFact("yield", `${topName} ${formatPercent(apy)}`, "result")
        : labelFact("protocol", asString(args?.protocol), "args"),
      poolLookup || total == null
        ? null
        : countFact(total, `${total} pool${total === 1 ? "" : "s"}`),
      failedFact(resultRecord),
    ],
    poolLookup ? "Check yield pool" : undefined,
  );
};

const matchProtocols = ({
  rawLabel,
  parsedArgs,
  resultRecord,
}: ToolContext) => {
  const args = asRecord(parsedArgs);
  const result = validResult(resultRecord) ? resultRecord : null;
  const query = asString(result?.query) ?? asString(args?.query);
  const category = asString(result?.category) ?? asString(args?.category);
  const mode =
    asString(result?.mode) ??
    (query ? "lookup" : args?.chain && !category ? "chain_overview" : "list");
  const chain = asRecord(result?.chain);
  // A chain overview groups protocols by category; lead with the largest.
  const protocols = result?.results
    ? records(result.results)
    : records(result?.categories)
        .flatMap((group) => records(group.protocols))
        .sort(
          (a, b) => (asNumber(b.tvl_usd) ?? 0) - (asNumber(a.tvl_usd) ?? 0),
        );

  return op(
    "defillama.protocols",
    rawLabel,
    [
      chainFact(
        result?.chain_id ?? chain?.chain_id,
        result?.chain_name ?? chain?.name,
      ) ?? argsChainFact(args?.chain),
      // The model's search text is noise; the matched protocols say enough.
      query ? null : labelFact("category", category, "args"),
      ...protocols
        .slice(0, MAX_PROTOCOLS)
        .map((protocol) =>
          labelFact(
            "protocol",
            asString(protocol.name),
            "result",
            asString(protocol.slug) ?? asString(protocol.name),
          ),
        ),
      failedFact(resultRecord),
    ],
    Object.hasOwn(PROTOCOL_TITLES, mode) ? PROTOCOL_TITLES[mode] : undefined,
  );
};

export const defillama: ProtocolAdapter = {
  descriptors: {
    "defillama.prices": {
      title: "fixed",
      fixedTitle: "Check prices",
      icon: CircleDollarSignIcon,
      chipPlan: [
        { kind: "chain" },
        { kind: "token", repeat: true },
        { kind: "count", role: "results" },
        { kind: "status" },
      ],
    },
    "defillama.yields": {
      title: "fixed",
      fixedTitle: "Find yields",
      icon: TrendingUpIcon,
      chipPlan: [
        { kind: "chain" },
        { kind: "token" },
        { kind: "category" },
        { kind: "yield" },
        { kind: "protocol" },
        { kind: "count", role: "results" },
        { kind: "status" },
      ],
    },
    "defillama.protocols": {
      title: "fixed",
      fixedTitle: "Find protocols",
      icon: LandmarkIcon,
      chipPlan: [
        { kind: "chain" },
        { kind: "category" },
        { kind: "protocol", repeat: true },
        { kind: "status" },
      ],
    },
  },
  tools: [
    "defillama_prices",
    "defillama_find_yields",
    "defillama_find_protocols",
  ],
  match: (ctx) => {
    switch (ctx.rawLabel.toLowerCase().trim()) {
      case "defillama_prices":
        return matchPrices(ctx);
      case "defillama_find_yields":
        return matchYields(ctx);
      default:
        return matchProtocols(ctx);
    }
  },
};
