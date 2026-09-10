import { useMemo } from "react";
import {
  AppWindow,
  CandlestickChart,
  CircleCheck,
  Code2,
  Compass,
  FlaskConical,
  Landmark,
  Repeat2,
  Sprout,
  WandSparkles,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import {
  conciseSkillDescription,
  skillLabel,
  type SkillSummary,
} from "@/lib/capabilities/skill-catalog";
import type { LibrarySelection } from "../library-detail-panel";
import type { CatalogPackage } from "../packages-catalog";

export type LibraryView =
  | "discover"
  | "installed"
  | "apps"
  | "skills"
  | LibraryCategory;
type LibraryCategory =
  | "lending"
  | "cross-chain"
  | "staking"
  | "trading"
  | "research"
  | "wallets"
  | "developer";

export const NAV_ITEMS: { id: LibraryView; label: string; icon: LucideIcon }[] =
  [
    { id: "discover", label: "Discover", icon: Compass },
    { id: "installed", label: "Installed", icon: CircleCheck },
    { id: "apps", label: "Apps", icon: AppWindow },
    { id: "skills", label: "Skills", icon: WandSparkles },
  ];

export const CATEGORIES: {
  id: LibraryCategory;
  label: string;
  icon: LucideIcon;
}[] = [
  { id: "lending", label: "Lending", icon: Landmark },
  { id: "cross-chain", label: "Swap & bridge", icon: Repeat2 },
  { id: "staking", label: "Staking", icon: Sprout },
  { id: "trading", label: "Trading", icon: CandlestickChart },
  { id: "research", label: "Research", icon: FlaskConical },
  { id: "wallets", label: "Tokens & wallets", icon: WalletCards },
  { id: "developer", label: "Developer", icon: Code2 },
];

const FEATURED = [
  "skill:aave",
  "skill:across",
  "skill:aerodrome",
  "skill:lifi_swap",
  "app:defillama",
  "app:dune",
  "app:hyperliquid",
  "skill:common_erc20",
];

export function selectionKey(selection: LibrarySelection): string {
  return `${selection.kind}:${selection.item.id}`;
}

export function selectionName(selection: LibrarySelection): string {
  return selection.kind === "app"
    ? selection.item.name
    : skillLabel(selection.item);
}

export function selectionDescription(selection: LibrarySelection): string {
  return selection.kind === "app"
    ? selection.item.description
    : conciseSkillDescription(selection.item.description);
}

export function inferLibraryCategory(
  selection: LibrarySelection,
): LibraryCategory | null {
  const tags = selection.kind === "skill" ? selection.item.tags.join(" ") : "";
  const text =
    `${selection.item.id} ${selectionName(selection)} ${selection.item.description} ${tags}`.toLowerCase();
  if (
    /bridge|cross[- ]chain|cctp|stargate|across|debridge|swap|uniswap|sushi|curve|aerodrome|jupiter|oneinch|lifi|raydium|meteora|sanctum/u.test(
      text,
    )
  ) {
    return "cross-chain";
  }
  if (/lend|borrow|repay|collateral|aave|compound|morpho|kamino/u.test(text)) {
    return "lending";
  }
  if (
    /stake|restake|yield|liquidity|lido|etherfi|kelp|renzo|rocket|pendle|yearn|eigenlayer|convex/u.test(
      text,
    )
  ) {
    return "staking";
  }
  if (
    /perp|market|trade|order|stock|prediction|hyperliquid|dydx|gmx|kalshi|polymarket|limitless/u.test(
      text,
    )
  ) {
    return "trading";
  }
  if (
    /wallet|payment|allowance|transfer|balance|erc[-_ ]?20|token/u.test(text)
  ) {
    return "wallets";
  }
  if (
    /query|analytics|research|data|chart|explain|portfolio|inspect/u.test(text)
  ) {
    return "research";
  }
  if (
    /deploy|developer|contract|nft|multisig|account abstraction|orchestrat|automat/u.test(
      text,
    )
  ) {
    return "developer";
  }
  return null;
}

export function useLibraryEntries({
  catalog,
  skills,
  installedIds,
  query,
  view,
}: {
  catalog: CatalogPackage[] | null;
  skills: SkillSummary[] | null;
  installedIds: ReadonlySet<string>;
  query: string;
  view: LibraryView;
}) {
  const appEntries = useMemo<LibrarySelection[]>(
    () => (catalog ?? []).map((item) => ({ kind: "app", item })),
    [catalog],
  );
  const skillEntries = useMemo<LibrarySelection[]>(
    () => (skills ?? []).map((item) => ({ kind: "skill", item })),
    [skills],
  );
  const allEntries = useMemo(
    () => [...appEntries, ...skillEntries],
    [appEntries, skillEntries],
  );
  const categoryCounts = useMemo(
    () =>
      new Map(
        CATEGORIES.map((category) => [
          category.id,
          allEntries.filter(
            (entry) => inferLibraryCategory(entry) === category.id,
          ).length,
        ]),
      ),
    [allEntries],
  );

  const visible = useMemo(() => {
    let source = allEntries;
    if (view === "installed")
      source = appEntries.filter((entry) => installedIds.has(entry.item.id));
    else if (view === "apps") source = appEntries;
    else if (view === "skills") source = skillEntries;
    else if (view !== "discover")
      source = allEntries.filter(
        (entry) => inferLibraryCategory(entry) === view,
      );

    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? source.filter((entry) =>
          `${selectionName(entry)} ${entry.item.description} ${entry.kind === "skill" ? entry.item.tags.join(" ") : entry.item.searchTerms.join(" ")}`
            .toLowerCase()
            .includes(needle),
        )
      : source;
    return [...filtered].sort((left, right) => {
      if (view !== "discover")
        return selectionName(left).localeCompare(selectionName(right));
      const leftRank = FEATURED.indexOf(selectionKey(left));
      const rightRank = FEATURED.indexOf(selectionKey(right));
      return (
        (leftRank < 0 ? FEATURED.length : leftRank) -
          (rightRank < 0 ? FEATURED.length : rightRank) ||
        selectionName(left).localeCompare(selectionName(right))
      );
    });
  }, [allEntries, appEntries, installedIds, query, skillEntries, view]);

  const listTitle = query.trim()
    ? "Results"
    : view === "discover"
      ? "Recommended"
      : view === "installed"
        ? "Installed"
        : view === "apps"
          ? "Apps"
          : view === "skills"
            ? "Skills"
            : (CATEGORIES.find((category) => category.id === view)?.label ??
              "Library");
  return {
    appEntries,
    skillEntries,
    allEntries,
    categoryCounts,
    visible,
    listTitle,
  };
}
