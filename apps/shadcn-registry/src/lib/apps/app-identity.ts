import type { AomiAppDescriptor } from "@aomi-labs/client";

export type AppCategoryInfo = {
  id: string;
  label: string;
  order: number;
};

export type AppInfo = {
  /** Exact app id received from the backend or caller. */
  id: string;
  /** Canonical presentation key shared by app names and artwork. */
  brandId: string;
  /** Backend application scope for hosted apps. */
  applicationId?: AomiAppDescriptor["applicationId"];
  displayName: string;
  abbr: string;
  category: AppCategoryInfo;
};

export const APP_CATEGORIES = {
  default: { id: "default", label: "Default", order: 0 },
  modes: { id: "modes", label: "Modes", order: 5 },
  cex: { id: "cex", label: "Centralized Exchanges", order: 10 },
  dex: { id: "dex", label: "DEX & Swaps", order: 20 },
  analytics: { id: "analytics", label: "Analytics", order: 30 },
  perps: { id: "perps", label: "Perps", order: 40 },
  social: { id: "social", label: "Social", order: 50 },
  prediction: { id: "prediction", label: "Prediction Markets", order: 60 },
  yield: { id: "yield", label: "Lending & Yield", order: 70 },
  gaming: { id: "gaming", label: "Gaming", order: 80 },
  wallets: { id: "wallets", label: "Wallets", order: 90 },
  custom: { id: "custom", label: "Other", order: 100 },
} satisfies Record<string, AppCategoryInfo>;

type CuratedAppInfo = Pick<AppInfo, "displayName" | "abbr" | "category">;
const entry = (
  displayName: string,
  abbr: string,
  category: AppCategoryInfo,
): CuratedAppInfo => ({ displayName, abbr, category });

const CURATED_APP_INFO = {
  default: entry("Aomi Core", "A", APP_CATEGORIES.default),
  auto: entry("Auto", "Au", APP_CATEGORIES.modes),
  orchestrator: entry("Orchestrator", "Or", APP_CATEGORIES.modes),
  across: entry("Across", "A", APP_CATEGORIES.dex),
  aave: entry("Aave", "A", APP_CATEGORIES.yield),
  binance: entry("Binance", "B", APP_CATEGORIES.cex),
  birdeye: entry("Birdeye", "B", APP_CATEGORIES.analytics),
  bybit: entry("Bybit", "B", APP_CATEGORIES.cex),
  cambrian: entry("Cambrian", "C", APP_CATEGORIES.analytics),
  coingecko: entry("CoinGecko", "CG", APP_CATEGORIES.analytics),
  cow: entry("CoW Protocol", "CoW", APP_CATEGORIES.dex),
  defillama: entry("DefiLlama", "DL", APP_CATEGORIES.analytics),
  dune: entry("Dune", "D", APP_CATEGORIES.analytics),
  dydx: entry("dYdX", "dY", APP_CATEGORIES.perps),
  etherscan: entry("Etherscan", "E", APP_CATEGORIES.analytics),
  github: entry("GitHub", "GH", APP_CATEGORIES.custom),
  gmx: entry("GMX", "G", APP_CATEGORIES.perps),
  hyperliquid: entry("Hyperliquid", "HL", APP_CATEGORIES.perps),
  jupiter: entry("Jupiter", "J", APP_CATEGORIES.dex),
  kaito: entry("Kaito", "K", APP_CATEGORIES.social),
  kalshi: entry("Kalshi", "K", APP_CATEGORIES.prediction),
  khalani: entry("Khalani", "K", APP_CATEGORIES.dex),
  krexa: entry("Krexa", "K", APP_CATEGORIES.custom),
  lifi: entry("LI.FI", "LI", APP_CATEGORIES.dex),
  limitless: entry("Limitless", "L", APP_CATEGORIES.prediction),
  linear: entry("Linear", "L", APP_CATEGORIES.custom),
  manifold: entry("Manifold", "M", APP_CATEGORIES.prediction),
  marinade: entry("Marinade", "M", APP_CATEGORIES.yield),
  molinar: entry("Molinar", "Mo", APP_CATEGORIES.gaming),
  morpho: entry("Morpho", "M", APP_CATEGORIES.yield),
  "morpho-vaults": entry("Morpho Vaults", "MV", APP_CATEGORIES.yield),
  neynar: entry("Neynar", "N", APP_CATEGORIES.social),
  notion: entry("Notion", "N", APP_CATEGORIES.custom),
  okx: entry("OKX", "OK", APP_CATEGORIES.cex),
  oneinch: entry("1inch", "1i", APP_CATEGORIES.dex),
  para: entry("Para", "P", APP_CATEGORIES.wallets),
  "para-consumer": entry("Para Consumer", "PC", APP_CATEGORIES.wallets),
  pelagos: entry("Pelagos", "P", APP_CATEGORIES.dex),
  polymarket: entry("Polymarket", "P", APP_CATEGORIES.prediction),
  "polymarket-rewards": entry(
    "Polymarket Rewards",
    "PR",
    APP_CATEGORIES.prediction,
  ),
  slack: entry("Slack", "S", APP_CATEGORIES.custom),
  solscan: entry("Solscan", "S", APP_CATEGORIES.analytics),
  stablefx: entry("Circle StableFX", "FX", APP_CATEGORIES.dex),
  svm: entry("Solana", "S", APP_CATEGORIES.wallets),
  "svm-transfer": entry("Solana Transfers", "ST", APP_CATEGORIES.wallets),
  uniswap: entry("Uniswap", "U", APP_CATEGORIES.dex),
  vaultsfyi: entry("vaults.fyi", "VF", APP_CATEGORIES.yield),
  "world-markets": entry("World Markets", "WM", APP_CATEGORIES.analytics),
  x: entry("X", "X", APP_CATEGORIES.social),
  yearn: entry("Yearn", "Y", APP_CATEGORIES.yield),
  zerox: entry("0x", "0x", APP_CATEGORIES.dex),
  zora: entry("Zora", "Z", APP_CATEGORIES.social),
} satisfies Record<string, CuratedAppInfo>;

export const CURATED_APP_IDS = Object.freeze(
  Object.keys(CURATED_APP_INFO),
) as readonly (keyof typeof CURATED_APP_INFO)[];

const APP_ALIASES: Readonly<Record<string, keyof typeof CURATED_APP_INFO>> = {
  "0x": "zerox",
  "1-inch": "oneinch",
  "1inch": "oneinch",
  "dune-analytics": "dune",
  getpara: "para",
  "li-fi": "lifi",
  "li.fi": "lifi",
  "para-customer": "para",
  twitter: "x",
};

function normalizeAppId(appId: string | null | undefined): string {
  return (appId ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/gu, "-")
    .replace(/-{2,}/gu, "-");
}

/** Return the presentation key shared by app text and artwork. */
export function canonicalAppId(appId: string | null | undefined): string {
  const normalized = normalizeAppId(appId);
  if (!normalized) return "unknown";
  return Object.prototype.hasOwnProperty.call(APP_ALIASES, normalized)
    ? APP_ALIASES[normalized]!
    : normalized;
}

function titleizeAppId(appId: string): string {
  return appId
    .split(/[-_\s]+/gu)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function fallbackAbbr(displayName: string): string {
  const words = displayName.match(/[\p{L}\p{N}]+/gu) ?? [];
  return (
    words
      .slice(0, 2)
      .map((word) => word.charAt(0))
      .join("")
      .toUpperCase() || "?"
  );
}

/** Resolve app presentation while retaining the exact wire identity for routing. */
export function resolveAppIdentity(app: string | AomiAppDescriptor): AppInfo {
  const descriptor = typeof app === "string" ? undefined : app;
  const wireId = typeof app === "string" ? app : app.name;

  // Private publishers own their presentation even if their wire name happens
  // to match a built-in app. An empty brand prevents accidental logo reuse.
  if (descriptor?.isPublic === false) {
    const displayName =
      descriptor.label?.trim() || titleizeAppId(wireId.trim()) || "Unknown App";
    return {
      id: wireId,
      brandId: "",
      applicationId: descriptor.applicationId,
      displayName,
      abbr: displayName === "Unknown App" ? "?" : fallbackAbbr(displayName),
      category: APP_CATEGORIES.custom,
    };
  }

  const brandId = canonicalAppId(wireId);
  const curated = Object.prototype.hasOwnProperty.call(
    CURATED_APP_INFO,
    brandId,
  )
    ? CURATED_APP_INFO[brandId as keyof typeof CURATED_APP_INFO]
    : undefined;
  if (curated) {
    return {
      id: wireId,
      brandId,
      applicationId: descriptor?.applicationId,
      ...curated,
    };
  }

  const displayName =
    descriptor?.label?.trim() || titleizeAppId(wireId.trim()) || "Unknown App";
  return {
    id: wireId,
    brandId,
    applicationId: descriptor?.applicationId,
    displayName,
    abbr: displayName === "Unknown App" ? "?" : fallbackAbbr(displayName),
    category: APP_CATEGORIES.custom,
  };
}
