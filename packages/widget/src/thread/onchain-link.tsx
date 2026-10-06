import { cn } from "@aomi-labs/react";
import { ExternalLink } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";

import { EtherscanIcon, SolscanIcon } from "@/components/icons/apps";
import {
  CONFIGURED_EVM_EXPLORERS,
  EVM_EXPLORERS,
  type IdentifierKind,
  validIdentifier,
} from "./explorer-links";

export type ExplorerLink = {
  /** EVM chain ID; null for Solana. */
  chainId: number | null;
  chainName: string;
  href: string;
};

const SOLANA_EXPLORERS: Record<string, string> = {
  "https://solscan.io": "Solana",
  "https://solscan.io?cluster=mainnet-beta": "Solana",
  "https://explorer.solana.com": "Solana",
  "https://explorer.solana.com?cluster=devnet": "Solana Devnet",
  "https://explorer.solana.com?cluster=testnet": "Solana Testnet",
};

// Supplied links to the registry's own explorers stay recognized where
// EVM_EXPLORERS overrides them (e.g. Robinhood Blockscout).
const EVM_ORIGINS = [
  ...Object.entries(EVM_EXPLORERS),
  ...Object.entries(CONFIGURED_EVM_EXPLORERS),
].map(([id, { name, base }]) => ({ chainId: Number(id), name, base }));

function isExplorerPath(path: string, solana: boolean): boolean {
  const match = path.match(/^\/(account|address|token|tx|block)\/([^/]+)$/);
  if (!match || (match[1] === "account" && !solana)) return false;
  const kind = match[1] === "account" ? "address" : match[1];
  return validIdentifier(match[2], kind as IdentifierKind, solana);
}

/** Classify known explorer URL shapes for display, not proof of inclusion. */
export function recognizeOnchainLink(href: string): ExplorerLink | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    return null;

  const solana = SOLANA_EXPLORERS[url.origin + url.search];
  if (solana) {
    return isExplorerPath(url.pathname, true)
      ? { chainId: null, chainName: solana, href }
      : null;
  }
  if (url.search) return null;

  for (const { chainId, name, base } of EVM_ORIGINS) {
    const root = new URL(base);
    const prefix = root.pathname.replace(/\/$/, "");
    if (
      url.origin === root.origin &&
      url.pathname.startsWith(`${prefix}/`) &&
      isExplorerPath(url.pathname.slice(prefix.length), false)
    )
      return { chainId, chainName: name, href: url.href };
  }
  return null;
}

export function OnchainLink({
  href,
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<"a">) {
  // Unsafe schemes (javascript:, data:, ...) render as plain copyable text.
  const safeHref = href && /^(https?:|mailto:)/i.test(href) ? href : undefined;
  if (!safeHref) return <span className={className}>{children}</span>;
  const explorer = recognizeOnchainLink(safeHref);
  if (!explorer) {
    return (
      <a
        href={safeHref}
        className={cn(
          "aui-md-a text-primary hover:text-primary/80 underline underline-offset-2",
          className,
        )}
        {...props}
      >
        {children}
      </a>
    );
  }
  const explorerHost = new URL(explorer.href).hostname;
  const Icon =
    explorerHost === "solscan.io"
      ? SolscanIcon
      : [
            "etherscan.io",
            "basescan.org",
            "arbiscan.io",
            "optimistic.etherscan.io",
            "bscscan.com",
            "polygonscan.com",
          ].includes(explorerHost)
        ? EtherscanIcon
        : ExternalLink;
  return (
    <a
      href={explorer.href}
      {...props}
      className={cn(
        "aui-md-a text-aomi-accent relative top-px mx-0.5 inline max-w-full align-baseline font-medium no-underline underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2",
        className,
      )}
      target="_blank"
      rel="noopener noreferrer"
    >
      <Icon
        aria-hidden="true"
        className="mr-1 inline-block size-3.5 align-middle"
      />
      <span className="break-all">{children}</span>
      <span className="sr-only"> on {explorer.chainName} explorer</span>
    </a>
  );
}
