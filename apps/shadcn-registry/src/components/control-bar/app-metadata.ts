/**
 * App metadata for UI display.
 * Maps raw backend app ids to display names, categories, and aliases.
 */

import type { AomiAppDescriptor } from "@aomi-labs/client";

export type AppInfo = {
  /** Raw app id sent to backend */
  id: string;
  /** Backend application scope for hosted apps. */
  applicationId?: AomiAppDescriptor["applicationId"];
  /** Human-readable display name */
  displayName: string;
  /** 1-2 letter abbreviation for avatar fallback */
  abbr: string;
  category: AppCategoryInfo;
};

export type AppCategoryInfo = {
  id: string;
  label: string;
  order: number;
};

export type AppGroup = {
  category: AppCategoryInfo;
  apps: AppInfo[];
};

const APP_CATEGORIES = {
  default: { id: "default", label: "Default", order: 0 },
  /** Ways of working rather than individual apps — pinned above app groups. */
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

const APP_DISPLAY_NAMES: Record<string, Omit<AppInfo, "id">> = {
  default: {
    displayName: "Basic",
    abbr: "B",
    category: APP_CATEGORIES.default,
  },
  across: {
    displayName: "Across",
    abbr: "A",
    category: APP_CATEGORIES.dex,
  },
  binance: {
    displayName: "Binance",
    abbr: "B",
    category: APP_CATEGORIES.cex,
  },
  bybit: {
    displayName: "Bybit",
    abbr: "B",
    category: APP_CATEGORIES.cex,
  },
  cambrian: {
    displayName: "Cambrian",
    abbr: "Ca",
    category: APP_CATEGORIES.analytics,
  },
  cow: {
    displayName: "CoW Protocol",
    abbr: "CoW",
    category: APP_CATEGORIES.dex,
  },
  defillama: {
    displayName: "DefiLlama",
    abbr: "DL",
    category: APP_CATEGORIES.analytics,
  },
  dune: {
    displayName: "Dune",
    abbr: "D",
    category: APP_CATEGORIES.analytics,
  },
  dydx: {
    displayName: "dYdX",
    abbr: "dY",
    category: APP_CATEGORIES.perps,
  },
  gmx: {
    displayName: "GMX",
    abbr: "G",
    category: APP_CATEGORIES.perps,
  },
  hyperliquid: {
    displayName: "Hyperliquid",
    abbr: "HL",
    category: APP_CATEGORIES.perps,
  },
  kaito: {
    displayName: "Kaito",
    abbr: "K",
    category: APP_CATEGORIES.social,
  },
  kalshi: {
    displayName: "Kalshi",
    abbr: "K",
    category: APP_CATEGORIES.prediction,
  },
  khalani: {
    displayName: "Khalani",
    abbr: "K",
    category: APP_CATEGORIES.dex,
  },
  lifi: {
    displayName: "LI.FI",
    abbr: "LI",
    category: APP_CATEGORIES.dex,
  },
  limitless: {
    displayName: "Limitless",
    abbr: "L",
    category: APP_CATEGORIES.prediction,
  },
  manifold: {
    displayName: "Manifold",
    abbr: "M",
    category: APP_CATEGORIES.prediction,
  },
  molinar: {
    displayName: "Molinar",
    abbr: "Mo",
    category: APP_CATEGORIES.gaming,
  },
  morpho: {
    displayName: "Morpho",
    abbr: "M",
    category: APP_CATEGORIES.yield,
  },
  "morpho-vaults": {
    displayName: "Morpho Vaults",
    abbr: "MV",
    category: APP_CATEGORIES.yield,
  },
  neynar: {
    displayName: "Neynar",
    abbr: "N",
    category: APP_CATEGORIES.social,
  },
  okx: {
    displayName: "OKX",
    abbr: "OK",
    category: APP_CATEGORIES.cex,
  },
  oneinch: {
    displayName: "1inch",
    abbr: "1i",
    category: APP_CATEGORIES.dex,
  },
  orchestrator: {
    displayName: "Orchestrator",
    abbr: "Or",
    category: APP_CATEGORIES.modes,
  },
  para: {
    displayName: "Para",
    abbr: "P",
    category: APP_CATEGORIES.wallets,
  },
  "para-consumer": {
    displayName: "Para Consumer",
    abbr: "P",
    category: APP_CATEGORIES.custom,
  },
  pelagos: {
    displayName: "Pelagos",
    abbr: "P",
    category: APP_CATEGORIES.dex,
  },
  polymarket: {
    displayName: "Polymarket",
    abbr: "P",
    category: APP_CATEGORIES.prediction,
  },
  "polymarket-rewards": {
    displayName: "Polymarket Rewards",
    abbr: "PR",
    category: APP_CATEGORIES.prediction,
  },
  vaultsfyi: {
    displayName: "vaults.fyi",
    abbr: "VF",
    category: APP_CATEGORIES.yield,
  },
  x: {
    displayName: "X",
    abbr: "X",
    category: APP_CATEGORIES.social,
  },
  yearn: {
    displayName: "Yearn",
    abbr: "Y",
    category: APP_CATEGORIES.yield,
  },
  zerox: {
    displayName: "0x",
    abbr: "0x",
    category: APP_CATEGORIES.dex,
  },
  zora: {
    displayName: "Zora",
    abbr: "Z",
    category: APP_CATEGORIES.social,
  },
};

const APP_ALIASES: Record<string, string> = {
  "1inch": "oneinch",
  "0x": "zerox",
  "li-fi": "lifi",
  "li.fi": "lifi",
  "dune-analytics": "dune",
  getpara: "para",
  "para-customer": "para",
  para_consumer: "para-consumer",
  polymarket_rewards: "polymarket-rewards",
  morpho_vaults: "morpho-vaults",
  "vaults.fyi": "vaultsfyi",
  "vaults-fyi": "vaultsfyi",
  twitter: "x",
};

function normalizeAppId(appId: string | null | undefined): string {
  return (appId ?? "").trim().toLowerCase();
}

function titleizeAppId(appId: string): string {
  return appId
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getAppInfo(appId: string | null | undefined): AppInfo {
  const safeAppId = appId ?? "";
  const normalized = normalizeAppId(safeAppId);
  if (!normalized) {
    return {
      id: "unknown",
      displayName: "Unknown App",
      abbr: "?",
      category: APP_CATEGORIES.custom,
    };
  }
  const canonicalId = APP_ALIASES[normalized] ?? normalized;
  const known = APP_DISPLAY_NAMES[canonicalId];
  if (known) {
    return { id: normalized, ...known };
  }
  const displayName = titleizeAppId(normalized);
  return {
    id: normalized,
    displayName,
    abbr: normalized.charAt(0).toUpperCase(),
    category: APP_CATEGORIES.custom,
  };
}

export function groupAppsByCategory(
  apps: Array<string | AomiAppDescriptor>,
): AppGroup[] {
  const grouped = new Map<string, AppInfo[]>();

  for (const app of apps) {
    const name =
      typeof app === "string"
        ? app
        : app && typeof app.name === "string"
          ? app.name
          : "";
    if (name.trim().length === 0) {
      continue;
    }
    const info = {
      ...getAppInfo(name),
      applicationId: typeof app === "string" ? undefined : app.applicationId,
    };
    const existing = grouped.get(info.category.id) ?? [];
    existing.push(info);
    grouped.set(info.category.id, existing);
  }

  return Array.from(grouped.values())
    .map((groupApps) => ({
      category: groupApps[0]?.category ?? APP_CATEGORIES.custom,
      apps: groupApps.sort((a, b) =>
        a.displayName.localeCompare(b.displayName, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      ),
    }))
    .sort(
      (a, b) =>
        a.category.order - b.category.order ||
        a.category.label.localeCompare(b.category.label),
    );
}
