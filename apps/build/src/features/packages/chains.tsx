import type { FC, SVGProps } from "react";
import { CHAIN_NAMES } from "@aomi-labs/client";
import {
  EthereumIcon,
  SolanaIcon,
  getChainIcon,
} from "@aomi-labs/widget/host-composition";

/** The chain ids of the registry's chain names (`registry::agent::CHAINS`) that have one. */
const CHAIN_IDS: Record<string, number> = {
  ethereum: 1,
  sepolia: 11155111,
  arbitrum: 42161,
  optimism: 10,
  polygon: 137,
  base: 8453,
  megaeth: 4326,
  robinhood: 4663,
  monad: 143,
  "monad-testnet": 10143,
  arc: 5042,
  "arc-testnet": 5042002,
};

type ChainView = { label: string; Icon?: FC<SVGProps<SVGSVGElement>> };

/**
 * An agent config's chain (a registry chain name, or the family words `evm`
 * and `svm`) as the widget draws it: a whole EVM family shows the Ethereum
 * mark. A name the widget has no chain for stays as written.
 */
export function chainView(name: string): ChainView {
  if (name === "evm") return { label: "EVM", Icon: EthereumIcon };
  if (name === "svm" || name === "solana")
    return { label: "Solana", Icon: SolanaIcon };
  const id = CHAIN_IDS[name];
  return id
    ? { label: CHAIN_NAMES[id] ?? name, Icon: getChainIcon(id) }
    : { label: name };
}

/** An agent's chains: icons only in a list cell, icon and name elsewhere. */
export function Chains({
  chains,
  compact = false,
}: {
  chains: string[];
  compact?: boolean;
}) {
  return (
    <span
      className={
        compact
          ? "text-aomi-fg flex min-w-0 items-center gap-1.5 overflow-hidden"
          : "inline-flex flex-wrap items-center justify-end gap-x-3 gap-y-1"
      }
    >
      {chains.map((name) => {
        const { label, Icon } = chainView(name);
        if (compact)
          return Icon ? (
            <Icon key={name} role="img" aria-label={label} className="size-4" />
          ) : (
            <span key={name} className="text-[12px]">
              {label}
            </span>
          );
        return (
          <span key={name} className="inline-flex items-center gap-1.5">
            {Icon ? <Icon aria-hidden className="size-4 shrink-0" /> : null}
            {label}
          </span>
        );
      })}
    </span>
  );
}
