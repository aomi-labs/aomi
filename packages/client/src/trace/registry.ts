import type { TraceIcon } from "./types";

export type SelectorMeta = {
  selector: string;
  name: string;
  title: string;
  chip: string;
  icon: TraceIcon;
  kind:
    | "erc20_balance"
    | "erc20_metadata"
    | "erc20_allowance"
    | "erc20_approve"
    | "erc20_transfer";
};

export const DEFAULT_TOOL_ICON = "tool";

/**
 * Generic EVM selectors that are stable across ERC-20-style tokens.
 * Protocol-specific selectors stay out of this table; those steps use the
 * model's label as the readable title and only show structurally decoded chips.
 */
export const EVM_SELECTOR_REGISTRY: Record<string, SelectorMeta> = {
  "0x70a08231": {
    selector: "0x70a08231",
    name: "balanceOf",
    title: "Get balance",
    chip: "balanceOf",
    icon: "wallet",
    kind: "erc20_balance",
  },
  "0xa9059cbb": {
    selector: "0xa9059cbb",
    name: "transfer",
    title: "Transfer token",
    chip: "transfer",
    icon: "send",
    kind: "erc20_transfer",
  },
  "0x23b872dd": {
    selector: "0x23b872dd",
    name: "transferFrom",
    title: "Transfer token",
    chip: "transferFrom",
    icon: "send",
    kind: "erc20_transfer",
  },
  "0x095ea7b3": {
    selector: "0x095ea7b3",
    name: "approve",
    title: "Approve token spend",
    chip: "approve",
    icon: "approve",
    kind: "erc20_approve",
  },
  "0xdd62ed3e": {
    selector: "0xdd62ed3e",
    name: "allowance",
    title: "Check allowance",
    chip: "allowance",
    icon: "allowance",
    kind: "erc20_allowance",
  },
  "0x313ce567": {
    selector: "0x313ce567",
    name: "decimals",
    title: "Read token decimals",
    chip: "decimals",
    icon: "coins",
    kind: "erc20_metadata",
  },
  "0x95d89b41": {
    selector: "0x95d89b41",
    name: "symbol",
    title: "Read token metadata",
    chip: "symbol",
    icon: "coins",
    kind: "erc20_metadata",
  },
  "0x06fdde03": {
    selector: "0x06fdde03",
    name: "name",
    title: "Read token metadata",
    chip: "name",
    icon: "coins",
    kind: "erc20_metadata",
  },
  "0x18160ddd": {
    selector: "0x18160ddd",
    name: "totalSupply",
    title: "Read token metadata",
    chip: "totalSupply",
    icon: "coins",
    kind: "erc20_metadata",
  },
};

export const STAGED_ACTION_ICON_REGISTRY: ReadonlyArray<
  readonly [RegExp, TraceIcon]
> = [
  [/\b(approv\w*|permit)\b/, "approve"],
  [/\b(allowance)\b/, "allowance"],
  [/\b(swap|trade|route)\b/, "swap"],
  [/\b(transfer|send|commit|execute|submit|broadcast)\b/, "send"],
  [/\b(bridge)\b/, "bridge"],
  [/\b(burn)\b/, "burn"],
  [/\b(mint|claim|collect|harvest)\b/, "coins"],
  [/\b(deposit|withdraw|stake|unstake|supply|redeem|wrap|unwrap)\b/, "wallet"],
];

export const SHAPE_ICONS = {
  chainContext: "globe",
  commit: "send",
  customCall: "tool",
  delegation: "agent",
  history: "history",
  nativeBalance: "wallet",
  receipt: "receipt",
  search: "search",
  signature: "sign",
  simulation: "simulate",
  skillActivation: "skill",
  staged: "layers",
  swap: "swap",
  tokenLookup: "search",
  verified: "verified",
  webPage: "page",
} satisfies Record<string, TraceIcon>;
