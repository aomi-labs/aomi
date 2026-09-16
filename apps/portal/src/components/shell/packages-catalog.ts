import type { AomiAppDescriptor } from "@aomi-labs/client";

export type PackageVisibility = "public" | "personal";
export type PackageCategory =
  | "Featured"
  | "Markets & onchain"
  | "Productivity"
  | "More"
  | "Your packages";

export interface CatalogPackage {
  /** The wire `AppSpec.name` — what install/uninstall is keyed on. */
  id: string;
  name: string;
  description: string;
  iconDomain?: string;
  iconUrl?: string;
  glyph?: "wallet" | "chart" | "shield";
  background: string;
  foreground: string;
  visibility: PackageVisibility;
  category: PackageCategory;
  /** Core apps the account depends on — always installed, not removable. */
  pinned?: boolean;
  /** Exact EVM chains declared by the official release. */
  chainIds: number[];
}

export const ARC_TESTNET_CHAIN_ID = 5_042_002;

export function isPackageAvailableOnChain(
  app: CatalogPackage,
  chainId: number | undefined,
): boolean {
  return (
    app.chainIds.length === 0 ||
    (chainId !== undefined && app.chainIds.includes(chainId))
  );
}

/**
 * Brand decoration keyed by wire app name — colors, icons, category, and copy
 * the catalog endpoint doesn't carry (AppSpec has no display metadata yet; see
 * docs/SETTINGS-REDESIGN-GAPS.md). Apps outside this map render a neutral
 * monogram tile under "More" — real, just undecorated.
 */
const DECOR: Record<
  string,
  Partial<
    Pick<
      CatalogPackage,
      | "name"
      | "description"
      | "iconDomain"
      | "iconUrl"
      | "glyph"
      | "background"
      | "foreground"
      | "category"
    >
  >
> = {
  uniswap: {
    name: "Uniswap",
    description: "Swap tokens and manage liquidity on Ethereum.",
    iconDomain: "uniswap.org",
    background: "#fff1f7",
    foreground: "#ff007a",
    category: "Featured",
  },
  jupiter: {
    name: "Jupiter",
    description: "Find and execute the best swap routes on Solana.",
    iconDomain: "jup.ag",
    background: "#effff8",
    foreground: "#144d3b",
    category: "Featured",
  },
  dune: {
    name: "Dune",
    description: "Query, chart, and explain onchain data.",
    iconDomain: "dune.com",
    background: "#fff5ee",
    foreground: "#f26f45",
    category: "Featured",
  },
  aave: {
    name: "Aave",
    description: "Lend, borrow, and monitor DeFi positions.",
    iconDomain: "aave.com",
    background: "#f3f0ff",
    foreground: "#7868e6",
    category: "Featured",
  },
  github: {
    name: "GitHub",
    description: "Triage PRs, issues, CI, and releases.",
    iconDomain: "github.com",
    background: "#f4f4f4",
    foreground: "#161616",
    category: "Featured",
  },
  coingecko: {
    name: "CoinGecko",
    description: "Track token prices, markets, and metadata.",
    iconDomain: "coingecko.com",
    background: "#f4ffe6",
    foreground: "#173300",
    category: "Markets & onchain",
  },
  etherscan: {
    name: "Etherscan",
    description: "Inspect Ethereum contracts and transactions.",
    iconDomain: "etherscan.io",
    background: "#eef8ff",
    foreground: "#4d96c7",
    category: "Markets & onchain",
  },
  birdeye: {
    name: "Birdeye",
    description: "Explore Solana tokens, markets, and wallets.",
    iconDomain: "birdeye.so",
    background: "#eef3ff",
    foreground: "#2d63e2",
    category: "Markets & onchain",
  },
  defillama: {
    name: "DefiLlama",
    description: "Compare protocols, yields, and TVL.",
    iconDomain: "defillama.com",
    background: "#e7f3fb",
    foreground: "#2777a8",
    category: "Markets & onchain",
  },
  hyperliquid: {
    name: "Hyperliquid",
    description: "Research markets and manage perp positions.",
    iconDomain: "hyperliquid.xyz",
    background: "#b8ffe2",
    foreground: "#12362b",
    category: "Markets & onchain",
  },
  stablefx: {
    name: "Circle StableFX",
    description: "Quote and settle institutional stablecoin FX on Arc.",
    iconDomain: "circle.com",
    background: "#eef7ff",
    foreground: "#136fd8",
    category: "Markets & onchain",
  },
  solscan: {
    name: "Solscan",
    description: "Inspect Solana accounts and transactions.",
    iconDomain: "solscan.io",
    background: "#f1edff",
    foreground: "#7f5af0",
    category: "Markets & onchain",
  },
  notion: {
    name: "Notion",
    description: "Search and organize your team knowledge.",
    iconDomain: "notion.so",
    background: "#f4f4f4",
    foreground: "#151515",
    category: "Productivity",
  },
  slack: {
    name: "Slack",
    description: "Turn team conversations into coordinated work.",
    iconDomain: "slack.com",
    background: "#fff3f8",
    foreground: "#e34b86",
    category: "Productivity",
  },
  linear: {
    name: "Linear",
    description: "Create and update product work.",
    iconDomain: "linear.app",
    background: "#f1f2ff",
    foreground: "#5e6ad2",
    category: "Productivity",
  },
  default: {
    name: "Aomi Core",
    description: "The built-in wallet, chain, and account tools.",
    glyph: "wallet",
    background: "#4e7af0",
    foreground: "#ffffff",
  },
};

/** Apps the account can't function without — shown installed, not removable. */
export const PINNED_APPS = new Set(["default"]);

export const CATEGORY_ORDER: readonly PackageCategory[] = [
  "Featured",
  "Markets & onchain",
  "Productivity",
  "More",
];

export const PERSONAL_CATEGORY_ORDER = ["Your packages"] as const;

export function explainPackageLoadError(cause: unknown): string {
  const fallback = "Couldn’t load packages. Please try again.";
  const raw = cause instanceof Error ? cause.message.trim() : "";

  // A failed Next proxy can return its entire HTML error document. Never put
  // that implementation detail into the modal (or let it stretch the layout).
  if (
    !raw ||
    raw.length > 240 ||
    raw.startsWith("<!DOCTYPE") ||
    raw.startsWith("<html")
  ) {
    return fallback;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "message" in parsed) {
      const message = String(parsed.message).trim();
      return message.length > 0 && message.length <= 240 ? message : fallback;
    }
    return fallback;
  } catch {
    return raw;
  }
}

/** One wire row + its decoration → a renderable catalog entry. */
export function toCatalogPackage(app: AomiAppDescriptor): CatalogPackage {
  const decor = DECOR[app.name.toLowerCase()] ?? {};
  const visibility: PackageVisibility =
    app.isPublic === false ? "personal" : "public";

  return {
    id: app.name,
    name: decor.name ?? app.label ?? app.name,
    description:
      decor.description ??
      (app.platform ? `From the ${app.platform} platform.` : "Aomi app."),
    iconDomain: decor.iconDomain,
    iconUrl: decor.iconUrl,
    glyph: decor.glyph,
    background: decor.background ?? "#f4f4f5",
    foreground: decor.foreground ?? "#3f3f46",
    visibility,
    category:
      visibility === "personal" ? "Your packages" : (decor.category ?? "More"),
    pinned: PINNED_APPS.has(app.name),
    chainIds: app.chainIds ?? [],
  };
}
