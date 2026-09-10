import type { AomiAppDescriptor } from "@aomi-labs/client";
import { resolveAppIdentity } from "@/lib/apps/app-identity";

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
  /** Canonical presentation key. Empty for private/custom apps. */
  brandId: string;
  /** Stable hosted-app identity, when supplied by the catalog. */
  applicationId?: AomiAppDescriptor["applicationId"];
  name: string;
  abbr: string;
  description: string;
  /** Non-visible backend names retained for Library search. */
  searchTerms: string[];
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
 * Product grouping and descriptive copy that the catalog endpoint doesn't
 * carry. Names and brand keys come from the shared app identity resolver so
 * the Library, composer, and Direct selector cannot drift.
 */
const DECOR: Record<
  string,
  Partial<Pick<CatalogPackage, "description" | "category">>
> = {
  uniswap: {
    description: "Swap tokens and manage liquidity on Ethereum.",
    category: "Featured",
  },
  jupiter: {
    description: "Find and execute the best swap routes on Solana.",
    category: "Featured",
  },
  dune: {
    description: "Query, chart, and explain onchain data.",
    category: "Featured",
  },
  aave: {
    description: "Lend, borrow, and monitor DeFi positions.",
    category: "Featured",
  },
  github: {
    description: "Triage PRs, issues, CI, and releases.",
    category: "Featured",
  },
  coingecko: {
    description: "Track token prices, markets, and metadata.",
    category: "Markets & onchain",
  },
  etherscan: {
    description: "Inspect Ethereum contracts and transactions.",
    category: "Markets & onchain",
  },
  birdeye: {
    description: "Explore Solana tokens, markets, and wallets.",
    category: "Markets & onchain",
  },
  defillama: {
    description: "Compare protocols, yields, and TVL.",
    category: "Markets & onchain",
  },
  hyperliquid: {
    description: "Research markets and manage perp positions.",
    category: "Markets & onchain",
  },
  stablefx: {
    description: "Quote and settle institutional stablecoin FX on Arc.",
    category: "Markets & onchain",
  },
  solscan: {
    description: "Inspect Solana accounts and transactions.",
    category: "Markets & onchain",
  },
  notion: {
    description: "Search and organize your team knowledge.",
    category: "Productivity",
  },
  slack: {
    description: "Turn team conversations into coordinated work.",
    category: "Productivity",
  },
  linear: {
    description: "Create and update product work.",
    category: "Productivity",
  },
  default: {
    description: "The built-in wallet, chain, and account tools.",
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
  const identity = resolveAppIdentity(app);
  const decor = DECOR[identity.brandId] ?? {};
  const visibility: PackageVisibility =
    app.isPublic === false ? "personal" : "public";

  return {
    id: app.name,
    brandId: identity.brandId,
    applicationId: identity.applicationId,
    name: identity.displayName,
    abbr: identity.abbr,
    description:
      decor.description ??
      (app.platform ? `From the ${app.platform} platform.` : "Aomi app."),
    searchTerms: [app.name, app.label]
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean),
    visibility,
    category:
      visibility === "personal" ? "Your packages" : (decor.category ?? "More"),
    pinned: PINNED_APPS.has(identity.brandId),
    chainIds: app.chainIds ?? [],
  };
}
