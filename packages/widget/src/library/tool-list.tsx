"use client";

import { useState, type FC } from "react";
import {
  ArrowDownLeftIcon,
  ArrowLeftRightIcon,
  ArrowUpRightIcon,
  BanIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  CoinsIcon,
  HistoryIcon,
  LandmarkIcon,
  ListIcon,
  PencilLineIcon,
  SearchIcon,
  TrendingUpIcon,
  UserIcon,
  WalletIcon,
  WrenchIcon,
} from "lucide-react";

import { cn } from "@/lib/cn";
import { Fold } from "@/thread/trace-motion";

type Tool = { name: string; description: string };

const WORDS: Record<string, string> = {
  abi: "ABI",
  api: "API",
  apy: "APY",
  btc: "BTC",
  cron: "",
  erc20: "ERC-20",
  eth: "ETH",
  evm: "EVM",
  id: "ID",
  ix: "instruction",
  lp: "LP",
  nft: "NFT",
  nfts: "NFTs",
  pnl: "PnL",
  svm: "Solana",
  tvl: "TVL",
  tx: "transaction",
  txs: "transactions",
  usd: "USD",
};

/** `find_yields` as a person would say it, without the package's own name. */
export function toolTitle(name: string, packageId: string): string {
  const own = new Set(packageId.toLowerCase().split(/[^a-z0-9]+/));
  const words = (name.split("::").at(-1) ?? name).split(/[_-]+/);
  const trimmed =
    words.length > 1 && own.has(words[0]!) ? words.slice(1) : words;
  const text = trimmed
    .map((word) => WORDS[word] ?? word)
    .filter(Boolean)
    .join(" ");
  return text.slice(0, 1).toUpperCase() + text.slice(1);
}

/** The first sentence, in plain text: the rest is written for the model. */
export function toolSummary(description: string): string {
  const text = description.replace(/[`*]/g, "").replace(/\s+/g, " ").trim();
  const sentence = /^.+?[.;](?=\s+[A-Z]|$)/.exec(text)?.[0] ?? text;
  // Code names belong to the model: stop before the part that uses them.
  const plain = /\w_\w/.test(sentence)
    ? (/^[^_]*?(?=[:(]|\s[–—-]\s)/.exec(sentence)?.[0] ?? sentence)
    : sentence;
  return plain
    .replace(/\b(WHEN|NOT|ONLY|MUST|NEVER|ALWAYS)\b/g, (word) =>
      word.toLowerCase(),
    )
    .replace(/[\s;:,.]*$/, ".");
}

const ICONS: [RegExp, FC<{ className?: string }>][] = [
  [/cancel|discard|revoke|archive|delete/, BanIcon],
  [/schedul|cron|wake|remind|alert/, ClockIcon],
  [/history|fills|trades|latest/, HistoryIcon],
  [/^(find|search|resolve|lookup)/, SearchIcon],
  [/^list|_list$|chains|orders$|^top/, ListIcon],
  [/balance|holding|portfolio|position|wallet|allowance/, WalletIcon],
  [/swap|quote|route|bridge|exchange/, ArrowLeftRightIcon],
  [/withdraw|claim|redeem|unstake|receive/, ArrowDownLeftIcon],
  [/send|transfer|submit|execute|post$|cast$|bet$/, ArrowUpRightIcon],
  [/prepare|stage|build|create|approve|sign|order$/, PencilLineIcon],
  [/yield|apy|price|rate$|trend|candle|tvl|funding|mids/, TrendingUpIcon],
  [/lend|supply|deposit|stake|vault|reserve|protocol|market/, LandmarkIcon],
  [/token|coin/, CoinsIcon],
  [/user|profile|account|holder/, UserIcon],
  [/search|find/, SearchIcon],
];

const toolIcon = (name: string) =>
  ICONS.find(([pattern]) => pattern.test(name))?.[1] ?? WrenchIcon;

const ToolRow: FC<{ tool: Tool; title: string }> = ({ tool, title }) => {
  const [open, setOpen] = useState(false);
  const Icon = toolIcon(tool.name);
  const summary = toolSummary(tool.description);
  const line = (
    <>
      <span className="text-aomi-muted group-hover/tool:text-aomi-fg flex w-4 shrink-0 justify-center transition-colors">
        <Icon className="size-[15px]" />
      </span>
      <span className="min-w-0 truncate">{title}</span>
    </>
  );
  const row =
    "flex min-h-[34px] w-full items-center gap-2.5 text-left text-[13px] leading-[18px]";
  if (!summary)
    return (
      <li title={tool.name} className={row}>
        {line}
      </li>
    );
  return (
    <li>
      <button
        type="button"
        title={tool.name}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          row,
          "group/tool focus-visible:outline-aomi-accent rounded-control outline-offset-2 focus-visible:outline-2",
        )}
      >
        {line}
        <ChevronRightIcon
          className={cn(
            "text-aomi-muted group-hover/tool:text-aomi-fg size-3 shrink-0 transition-[rotate,opacity,color] duration-300",
            open
              ? "rotate-90 opacity-75"
              : "opacity-40 group-hover/tool:opacity-75",
          )}
        />
      </button>
      <Fold open={open}>
        <p className="type-meta text-aomi-muted pb-2.5 pl-[26px] pr-2">
          {summary}
        </p>
      </Fold>
    </li>
  );
};

const FIRST = 6;

/** What a package can do: plain names, each opening to one sentence. */
export const ToolList: FC<{ tools: readonly Tool[]; packageId: string }> = ({
  tools,
  packageId,
}) => {
  const [all, setAll] = useState(false);
  // One hidden row is not worth a button.
  const limit = tools.length > FIRST + 1 ? FIRST : tools.length;
  const rows = (list: readonly Tool[]) =>
    list.map((tool) => (
      <ToolRow
        key={tool.name}
        tool={tool}
        title={toolTitle(tool.name, packageId)}
      />
    ));
  return (
    <div className="flex flex-col">
      <ul>{rows(tools.slice(0, limit))}</ul>
      {tools.length > limit ? (
        <>
          <Fold open={all}>
            <ul>{rows(tools.slice(limit))}</ul>
          </Fold>
          <button
            type="button"
            aria-expanded={all}
            onClick={() => setAll((value) => !value)}
            className="text-aomi-muted hover:text-aomi-fg rounded-control focus-visible:outline-aomi-accent flex min-h-[34px] w-fit items-center gap-2.5 text-[13px] leading-[18px] outline-offset-2 transition-colors focus-visible:outline-2"
          >
            <ChevronDownIcon
              className={cn(
                "mx-0.5 size-3 opacity-75 transition-[rotate] duration-300",
                all && "rotate-180",
              )}
            />
            {all ? "Show fewer" : `Show all ${tools.length} tools`}
          </button>
        </>
      ) : null}
    </div>
  );
};
