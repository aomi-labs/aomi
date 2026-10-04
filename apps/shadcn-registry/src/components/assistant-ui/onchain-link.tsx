import { cn } from "@aomi-labs/react";
import { ExternalLink } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";

import { EtherscanIcon, SolscanIcon } from "@/components/icons/apps";
import { EVM_EXPLORERS, validIdentifier } from "./explorer-links";

type ExplorerKind = "tx" | "address" | "token" | "block";

export type ExplorerLink = {
  /** EVM chain ID; Solana has no EVM numeric identity. */
  chainId: number | null;
  chainName: string;
  href: string;
};

const TX_ID = /^0x[a-fA-F0-9]{64}$/;
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const BLOCK_ID = /^(?:0|[1-9][0-9]*|0x[a-fA-F0-9]{64})$/;

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

  // Solscan's mainnet account/token and transaction pages. Recognize only
  // supplied links; never infer a network or construct a URL from bare text.
  if (url.origin === "https://solscan.io") {
    if (url.search && url.search !== "?cluster=mainnet-beta") return null;
    const match = url.pathname.match(/^\/(account|token|tx|block)\/([^/]+)$/);
    if (!match) return null;
    const kind =
      match[1] === "account"
        ? "address"
        : (match[1] as "token" | "tx" | "block");
    if (!validIdentifier(match[2], kind, true)) return null;
    return { chainId: null, chainName: "Solana", href };
  }

  if (url.origin === "https://explorer.solana.com") {
    const query = url.search;
    const cluster =
      query === "?cluster=devnet"
        ? "Devnet"
        : query === "?cluster=testnet"
          ? "Testnet"
          : query === ""
            ? "Mainnet"
            : null;
    const match = url.pathname.match(/^\/(address|tx|block)\/([^/]+)$/);
    if (!cluster || !match) return null;
    const kind =
      match[1] === "address" ? "address" : (match[1] as "tx" | "block");
    if (!validIdentifier(match[2], kind, true)) return null;
    return { chainId: null, chainName: `Solana ${cluster}`, href };
  }
  if (url.search) return null;

  const explorers = Object.entries(EVM_EXPLORERS).map(
    ([id, explorer]) => [id, explorer.name, explorer.base] as const,
  );
  for (const [id, name, configured] of explorers) {
    const chainId = Number(id);
    // A local fork can have a familiar chain name but has no live explorer.
    if (chainId === 31337) continue;
    if (!configured) continue;
    const base = new URL(configured);
    if (base.protocol !== "https:" || url.origin !== base.origin) continue;
    const root = base.pathname.replace(/\/$/, "");
    if (!url.pathname.startsWith(`${root}/`)) continue;
    const match = url.pathname
      .slice(root.length + 1)
      .match(/^(tx|address|token|block)\/([^/]+)$/);
    if (!match) continue;
    const kind = match[1] as ExplorerKind;
    const identifier = match[2];
    const valid =
      kind === "tx"
        ? TX_ID.test(identifier)
        : kind === "block"
          ? BLOCK_ID.test(identifier)
          : ADDRESS.test(identifier);
    if (!valid) continue;
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
  // Apply the same scheme boundary to supplied links and constructed links.
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
