import {
  ArrowRightLeftIcon,
  BadgeCheckIcon,
  BotIcon,
  CableIcon,
  CoinsIcon,
  FlameIcon,
  FlaskConicalIcon,
  GlobeIcon,
  LayersIcon,
  PenLineIcon,
  PencilLineIcon,
  SearchIcon,
  SendIcon,
  SparklesIcon,
  TrendingUpIcon,
  WalletIcon,
  WrenchIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type SelectorMeta = {
  selector: string;
  name: string;
  title: string;
  chip: string;
  icon: LucideIcon;
  kind:
    | "erc20_balance"
    | "erc20_metadata"
    | "erc20_allowance"
    | "erc20_approve"
    | "erc20_transfer";
};

export const DEFAULT_TOOL_ICON = WrenchIcon;

/**
 * Generic EVM selectors that are stable across ERC-20-style tokens.
 * Protocol-specific selectors stay out of this table; those steps use the
 * model's label as the readable title and only show structurally decoded chips.
 */
export const EVM_SELECTOR_REGISTRY: Record<string, SelectorMeta> = {
  "0x70a08231": {
    selector: "0x70a08231",
    name: "balanceOf",
    title: "Check token balance",
    chip: "balanceOf",
    icon: WalletIcon,
    kind: "erc20_balance",
  },
  "0xa9059cbb": {
    selector: "0xa9059cbb",
    name: "transfer",
    title: "Transfer token",
    chip: "transfer",
    icon: SendIcon,
    kind: "erc20_transfer",
  },
  "0x23b872dd": {
    selector: "0x23b872dd",
    name: "transferFrom",
    title: "Transfer token",
    chip: "transferFrom",
    icon: SendIcon,
    kind: "erc20_transfer",
  },
  "0x095ea7b3": {
    selector: "0x095ea7b3",
    name: "approve",
    title: "Approve token spend",
    chip: "approve",
    icon: PencilLineIcon,
    kind: "erc20_approve",
  },
  "0xdd62ed3e": {
    selector: "0xdd62ed3e",
    name: "allowance",
    title: "Check allowance",
    chip: "allowance",
    icon: PenLineIcon,
    kind: "erc20_allowance",
  },
  "0x313ce567": {
    selector: "0x313ce567",
    name: "decimals",
    title: "Read token decimals",
    chip: "decimals",
    icon: CoinsIcon,
    kind: "erc20_metadata",
  },
  "0x95d89b41": {
    selector: "0x95d89b41",
    name: "symbol",
    title: "Read token metadata",
    chip: "symbol",
    icon: CoinsIcon,
    kind: "erc20_metadata",
  },
  "0x06fdde03": {
    selector: "0x06fdde03",
    name: "name",
    title: "Read token metadata",
    chip: "name",
    icon: CoinsIcon,
    kind: "erc20_metadata",
  },
  "0x18160ddd": {
    selector: "0x18160ddd",
    name: "totalSupply",
    title: "Read token metadata",
    chip: "totalSupply",
    icon: CoinsIcon,
    kind: "erc20_metadata",
  },
};

export const TOPIC_ICON_REGISTRY: ReadonlyArray<readonly [RegExp, LucideIcon]> =
  [
    [/simulat/, FlaskConicalIcon],
    [/^\s*stag|\bstage\b/, LayersIcon],
    [/^\s*burn/, FlameIcon],
    [/^\s*(send|commit|execute|submit|broadcast|transfer)/, SendIcon],
    [/\bswap/, ArrowRightLeftIcon],
    [/^\s*bridg/, CableIcon],
    [/\b(sign|approv|allowance)/, PenLineIcon],
    [/\b(chain context|context|network|gas|block)\b/, GlobeIcon],
    [/\b(balance|position|portfolio|holding|wallet)/, WalletIcon],
    [/\b(decimal|symbol|metadata|supply)/, CoinsIcon],
    [/\b(price|quote|market|value)/, TrendingUpIcon],
    [/\b(activat|skill)/, SparklesIcon],
    [/\b(search|find|look ?up|resolve|fetch|get|check|read)/, SearchIcon],
  ];

export const STAGED_ACTION_ICON_REGISTRY: ReadonlyArray<
  readonly [RegExp, LucideIcon]
> = [
  [/\b(approv\w*|permit)\b/, PencilLineIcon],
  [/\b(allowance)\b/, PenLineIcon],
  [/\b(swap|trade|route)\b/, ArrowRightLeftIcon],
  [/\b(transfer|send|commit|execute|submit|broadcast)\b/, SendIcon],
  [/\b(bridge)\b/, CableIcon],
  [/\b(burn)\b/, FlameIcon],
  [/\b(mint|claim|collect|harvest)\b/, CoinsIcon],
  [
    /\b(deposit|withdraw|stake|unstake|supply|redeem|wrap|unwrap)\b/,
    WalletIcon,
  ],
];

export const SHAPE_ICONS = {
  chainContext: GlobeIcon,
  commit: SendIcon,
  customCall: WrenchIcon,
  delegation: BotIcon,
  nativeBalance: WalletIcon,
  search: SearchIcon,
  simulation: FlaskConicalIcon,
  skillActivation: SparklesIcon,
  staged: LayersIcon,
  swap: ArrowRightLeftIcon,
  tokenLookup: SearchIcon,
  verified: BadgeCheckIcon,
} satisfies Record<string, LucideIcon>;
