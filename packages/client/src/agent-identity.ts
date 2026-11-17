// How agents are named and grouped wherever they are shown (composer, CLI).
import type { AgentCard } from "./types";

export type AgentCategoryInfo = {
  id: string;
  label: string;
  order: number;
};

export type AgentInfo = {
  /** Exact agent id received from the backend or caller. */
  id: string;
  /** Canonical presentation key shared by agent names and artwork. */
  brandId: string;
  /** Backend agent scope for hosted agents. */
  agentId?: AgentCard["agent_id"];
  displayName: string;
  abbr: string;
  category: AgentCategoryInfo;
};

export const AGENT_CATEGORIES = {
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
} satisfies Record<string, AgentCategoryInfo>;

type CuratedAgentInfo = Pick<AgentInfo, "displayName" | "abbr" | "category">;
const entry = (
  displayName: string,
  abbr: string,
  category: AgentCategoryInfo,
): CuratedAgentInfo => ({ displayName, abbr, category });

const CURATED_AGENT_INFO = {
  default: entry("Aomi Core", "A", AGENT_CATEGORIES.default),
  auto: entry("Auto", "Au", AGENT_CATEGORIES.modes),
  orchestrator: entry("Orchestrator", "Or", AGENT_CATEGORIES.modes),
  across: entry("Across", "A", AGENT_CATEGORIES.dex),
  aave: entry("Aave", "A", AGENT_CATEGORIES.yield),
  binance: entry("Binance", "B", AGENT_CATEGORIES.cex),
  birdeye: entry("Birdeye", "B", AGENT_CATEGORIES.analytics),
  bybit: entry("Bybit", "B", AGENT_CATEGORIES.cex),
  cambrian: entry("Cambrian", "C", AGENT_CATEGORIES.analytics),
  coingecko: entry("CoinGecko", "CG", AGENT_CATEGORIES.analytics),
  cow: entry("CoW Protocol", "CoW", AGENT_CATEGORIES.dex),
  defillama: entry("DefiLlama", "DL", AGENT_CATEGORIES.analytics),
  dune: entry("Dune", "D", AGENT_CATEGORIES.analytics),
  dydx: entry("dYdX", "dY", AGENT_CATEGORIES.perps),
  etherscan: entry("Etherscan", "E", AGENT_CATEGORIES.analytics),
  github: entry("GitHub", "GH", AGENT_CATEGORIES.custom),
  gmx: entry("GMX", "G", AGENT_CATEGORIES.perps),
  hoodit: entry("Hoodit", "H", AGENT_CATEGORIES.analytics),
  hyperliquid: entry("Hyperliquid", "HL", AGENT_CATEGORIES.perps),
  jupiter: entry("Jupiter", "J", AGENT_CATEGORIES.dex),
  kaito: entry("Kaito", "K", AGENT_CATEGORIES.social),
  kalshi: entry("Kalshi", "K", AGENT_CATEGORIES.prediction),
  khalani: entry("Khalani", "K", AGENT_CATEGORIES.dex),
  krexa: entry("Krexa", "K", AGENT_CATEGORIES.custom),
  lifi: entry("LI.FI", "LI", AGENT_CATEGORIES.dex),
  limitless: entry("Limitless", "L", AGENT_CATEGORIES.prediction),
  linear: entry("Linear", "L", AGENT_CATEGORIES.custom),
  manifold: entry("Manifold", "M", AGENT_CATEGORIES.prediction),
  marinade: entry("Marinade", "M", AGENT_CATEGORIES.yield),
  molinar: entry("Molinar", "Mo", AGENT_CATEGORIES.gaming),
  morpho: entry("Morpho", "M", AGENT_CATEGORIES.yield),
  "morpho-vaults": entry("Morpho Vaults", "MV", AGENT_CATEGORIES.yield),
  neynar: entry("Neynar", "N", AGENT_CATEGORIES.social),
  notion: entry("Notion", "N", AGENT_CATEGORIES.custom),
  okx: entry("OKX", "OK", AGENT_CATEGORIES.cex),
  oneinch: entry("1inch", "1i", AGENT_CATEGORIES.dex),
  para: entry("Para", "P", AGENT_CATEGORIES.wallets),
  "para-consumer": entry("Para Consumer", "PC", AGENT_CATEGORIES.wallets),
  pelagos: entry("Pelagos", "P", AGENT_CATEGORIES.dex),
  polymarket: entry("Polymarket", "P", AGENT_CATEGORIES.prediction),
  "polymarket-rewards": entry(
    "Polymarket Rewards",
    "PR",
    AGENT_CATEGORIES.prediction,
  ),
  slack: entry("Slack", "S", AGENT_CATEGORIES.custom),
  solscan: entry("Solscan", "S", AGENT_CATEGORIES.analytics),
  stablefx: entry("Circle StableFX", "FX", AGENT_CATEGORIES.dex),
  svm: entry("Solana", "S", AGENT_CATEGORIES.wallets),
  "svm-transfer": entry("Solana Transfers", "ST", AGENT_CATEGORIES.wallets),
  uniswap: entry("Uniswap", "U", AGENT_CATEGORIES.dex),
  vaultsfyi: entry("vaults.fyi", "VF", AGENT_CATEGORIES.yield),
  "world-markets": entry("World Markets", "WM", AGENT_CATEGORIES.analytics),
  x: entry("X", "X", AGENT_CATEGORIES.social),
  yearn: entry("Yearn", "Y", AGENT_CATEGORIES.yield),
  zerox: entry("0x", "0x", AGENT_CATEGORIES.dex),
  zora: entry("Zora", "Z", AGENT_CATEGORIES.social),
} satisfies Record<string, CuratedAgentInfo>;

export const CURATED_AGENT_IDS = Object.freeze(
  Object.keys(CURATED_AGENT_INFO),
) as readonly (keyof typeof CURATED_AGENT_INFO)[];

const AGENT_ALIASES: Readonly<Record<string, keyof typeof CURATED_AGENT_INFO>> =
  {
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

function normalizeAgentId(agentScope: string | null | undefined): string {
  return (agentScope ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/gu, "-")
    .replace(/-{2,}/gu, "-");
}

/** Return the presentation key shared by agent text and artwork. */
export function canonicalAgentId(
  agentScope: string | null | undefined,
): string {
  const normalized = normalizeAgentId(agentScope);
  if (!normalized) return "unknown";
  return Object.prototype.hasOwnProperty.call(AGENT_ALIASES, normalized)
    ? AGENT_ALIASES[normalized]!
    : normalized;
}

function titleizeAgentId(agentScope: string): string {
  return agentScope
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

/** Resolve agent presentation while retaining the exact wire identity for routing. */
export function resolveAgentIdentity(value: string | AgentCard): AgentInfo {
  const id = typeof value === "string" ? value : value.agent;
  const brandId = id.startsWith("aomi/")
    ? id.slice(5)
    : id.includes("/")
      ? ""
      : canonicalAgentId(id);
  const curated =
    CURATED_AGENT_INFO[brandId as keyof typeof CURATED_AGENT_INFO];
  const displayName =
    typeof value === "string"
      ? (curated?.displayName ??
        (titleizeAgentId(id.split("/").at(-1) ?? id) || "Unknown Agent"))
      : value.display_name;
  return {
    id,
    brandId,
    agentId: typeof value === "string" ? undefined : value.agent_id,
    displayName,
    abbr:
      curated?.abbr ??
      (displayName === "Unknown Agent" ? "?" : fallbackAbbr(displayName)),
    category: curated?.category ?? AGENT_CATEGORIES.custom,
  };
}
