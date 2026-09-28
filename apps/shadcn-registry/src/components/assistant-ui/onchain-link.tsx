import { CHAINS_BY_ID } from "@aomi-labs/client";
import { cn } from "@aomi-labs/react";
import { ExternalLink } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";

import { getChainIcon } from "@/components/icons/chain-map";

type ExplorerKind = "tx" | "address" | "token" | "block";

export type ExplorerLink = {
  chainId: number;
  chainName: string;
  kind: ExplorerKind;
  href: string;
};

const TX_ID = /^0x[a-fA-F0-9]{64}$/;
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const BLOCK_ID = /^(?:0|[1-9][0-9]*|0x[a-fA-F0-9]{64})$/;

/** Classify configured explorer URL shapes for display, not proof of inclusion. */
export function recognizeOnchainLink(
  href: string,
  expectedChainId?: number,
): ExplorerLink | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    return null;

  for (const [id, chain] of Object.entries(CHAINS_BY_ID)) {
    const chainId = Number(id);
    if (expectedChainId != null && chainId !== expectedChainId) continue;
    // A local fork can have a familiar chain name but has no live explorer.
    if (chainId === 31337) continue;
    const configured = chain.blockExplorers?.default?.url;
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
    return { chainId, chainName: chain.name, kind, href: url.href };
  }
  return null;
}

export function OnchainLink({
  href,
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<"a">) {
  const explorer = href ? recognizeOnchainLink(href) : null;
  if (!explorer) {
    return (
      <a
        href={href}
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
  const ChainIcon = getChainIcon(explorer.chainId) ?? ExternalLink;
  return (
    <a
      href={explorer.href}
      {...props}
      className={cn(
        "aui-md-a text-aomi-accent border-aomi-accent/20 bg-aomi-accent/10 hover:bg-aomi-accent/15 inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 align-baseline font-medium underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2",
        className,
      )}
      target="_blank"
      rel="noopener noreferrer"
    >
      <ChainIcon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="min-w-0 break-all">{children}</span>
      <span className="sr-only"> on {explorer.chainName} explorer</span>
    </a>
  );
}
