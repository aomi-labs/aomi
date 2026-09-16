"use client";

import { useMemo, useState, type FC, type SVGProps } from "react";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { cn, getChainInfo } from "@aomi-labs/react";
import type { Chain } from "viem";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { getChainIcon, SolanaIcon } from "@/components/icons";
import {
  useAomiWalletKit,
  useWalletActivationGuard,
} from "../../lib/wallet-kit";
import { useOptionalAomiWalletNetworkPreferences } from "../../lib/wallet-kit/network-preferences";
import type {
  AomiNetworkTarget,
  SvmNetworkOption,
  WalletFamily,
} from "../../lib/wallet-kit/types";

export type NetworkSelectProps = {
  className?: string;
  chains?: readonly Chain[];
};

type GlyphIcon = FC<SVGProps<SVGSVGElement>>;

/** A single switchable network row, family-agnostic so EVM + Solana share one list. */
type NetworkRow = {
  family: WalletFamily;
  key: string;
  title: string;
  Icon?: GlyphIcon;
  /** Two-letter fallback when no brand mark exists (EVM only). */
  fallback: string;
  /** Mainnets show by default; testnets fold behind the "Show testnets" toggle. */
  isTestnet: boolean;
  isActive: boolean;
  /** Free-text the search input matches against (name + family + ticker/cluster). */
  searchValue: string;
  target: AomiNetworkTarget;
};

type NetworkSection = {
  family: WalletFamily;
  rows: NetworkRow[];
};

/**
 * Show the search box only once the default (mainnet) list is long enough that
 * scanning gets slow. At the typical handful of curated chains a search box is
 * just chrome, so it stays hidden — matching the App/Model selectors' intent
 * (search earns its place on large catalogs) without bloating the small case.
 * One number to tune: drop it to 0 to always show search, raise it to never.
 */
const SEARCH_VISIBLE_THRESHOLD = 10;

/** Standalone UI preference (not a wallet selection), so it lives outside WalletPreferences. */
const TESTNET_PREF_KEY = "aomi.network-select.show-testnets";

function readShowTestnetsPref(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(TESTNET_PREF_KEY) === "true";
  } catch {
    return false;
  }
}

function writeShowTestnetsPref(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TESTNET_PREF_KEY, value ? "true" : "false");
  } catch {
    // best-effort — preference is non-critical.
  }
}

function familyLabel(family: WalletFamily): string {
  return family === "svm" ? "SVM" : "EVM";
}

function isTestnetChain(chain: Chain): boolean {
  return chain.testnet === true;
}

function isSolanaMainnet(network: SvmNetworkOption): boolean {
  return network.cluster === "solana:mainnet";
}

function formatSolanaBadge(network: SvmNetworkOption): string {
  if (network.cluster === "solana:mainnet") return "Solana";
  if (network.cluster === "solana:testnet") return "Testnet";
  return "Devnet";
}

export const NetworkSelect: FC<NetworkSelectProps> = ({
  className,
  chains,
}) => {
  const adapter = useAomiWalletKit();
  // Optional: a standalone <AomiFrame /> (e.g. docs demo / SSR) may render
  // without a wallet provider mounting the network preferences context.
  const networkPreferences = useOptionalAomiWalletNetworkPreferences();
  const selectedEvmChainId = networkPreferences?.selectedEvmChainId;
  const selectedSolanaNetwork = networkPreferences?.selectedSolanaNetwork;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [showTestnets, setShowTestnets] =
    useState<boolean>(readShowTestnetsPref);
  const [pendingTarget, setPendingTarget] = useState<AomiNetworkTarget | null>(
    null,
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const canActivateWallet = useWalletActivationGuard();

  const identity = adapter.identity;
  const evmChains =
    chains ?? adapter.supportedNetworks?.evm ?? adapter.supportedChains ?? [];
  const solanaNetworks = adapter.supportedNetworks?.solana ?? [];

  // EVM networks only appear when they can affect the connected EVM wallet (or
  // before connect), while Solana remains available as a read-only preference
  // so users can inspect Solana data without attaching a Solana wallet first.
  const evmConnected = Boolean(identity.address);
  const solanaConnected = Boolean(identity.svmAddress);
  const anyConnected = evmConnected || solanaConnected;
  const showEvm = evmChains.length > 0 && (anyConnected ? evmConnected : true);
  const showSolana = solanaNetworks.length > 0;

  const liveEvmChainSupported =
    identity.chainId !== undefined &&
    evmChains.some((chain) => chain.id === identity.chainId);
  const activeEvmChainId = liveEvmChainSupported
    ? identity.chainId
    : selectedEvmChainId;
  const activeEvmChain = evmChains.find(
    (chain) => chain.id === activeEvmChainId,
  );
  const liveSolanaCluster = identity.svmCluster;
  const liveSolanaNetwork = solanaConnected
    ? solanaNetworks.find((network) => network.cluster === liveSolanaCluster)
    : undefined;
  const activeSolanaNetwork = liveSolanaNetwork ?? selectedSolanaNetwork;

  const sections = useMemo<NetworkSection[]>(() => {
    const result: NetworkSection[] = [];
    if (showEvm) {
      result.push({
        family: "evm",
        rows: evmChains.map((chain) => {
          const ticker =
            getChainInfo(chain.id)?.ticker ??
            ("nativeCurrency" in chain ? chain.nativeCurrency.symbol : "");
          return {
            family: "evm",
            key: `evm:${chain.id}`,
            title: chain.name,
            Icon: getChainIcon(chain.id),
            fallback: ticker.slice(0, 2),
            isTestnet: isTestnetChain(chain),
            isActive: activeEvmChainId === chain.id,
            searchValue: `${chain.name} evm ${ticker} ${chain.id}`,
            target: { family: "evm", chainId: chain.id },
          };
        }),
      });
    }
    if (showSolana) {
      result.push({
        family: "svm",
        rows: solanaNetworks.map((network) => ({
          family: "svm",
          key: `solana:${network.id}`,
          title: network.label,
          Icon: SolanaIcon,
          fallback: formatSolanaBadge(network).slice(0, 2),
          isTestnet: !isSolanaMainnet(network),
          isActive: activeSolanaNetwork?.id === network.id,
          searchValue: `${network.label} svm solana ${formatSolanaBadge(network)} ${network.id}`,
          target: { family: "svm", networkId: network.id },
        })),
      });
    }
    return result;
  }, [
    showEvm,
    showSolana,
    evmChains,
    solanaNetworks,
    activeEvmChainId,
    activeSolanaNetwork?.id,
  ]);

  // Trigger pairs each shown family's brand mark with its live network
  // (e.g. a dual session reads "Base / Solana"); the icon carries the family,
  // so the SVM label stays to its cluster.
  const triggerChips = useMemo(() => {
    const chips: { family: WalletFamily; Icon?: GlyphIcon; label: string }[] =
      [];
    if (showEvm) {
      chips.push({
        family: "evm",
        Icon: activeEvmChainId ? getChainIcon(activeEvmChainId) : undefined,
        label: activeEvmChain?.name ?? "EVM",
      });
    }
    if (showSolana) {
      chips.push({
        family: "svm",
        Icon: SolanaIcon,
        label: activeSolanaNetwork
          ? formatSolanaBadge(activeSolanaNetwork)
          : "SVM",
      });
    }
    return chips;
  }, [
    showEvm,
    showSolana,
    activeEvmChain,
    activeEvmChainId,
    activeSolanaNetwork,
  ]);

  const showGroupHeaders = sections.length > 1;
  const allRows = sections.flatMap((section) => section.rows);
  const visibleTargetCount = allRows.length;
  const mainnetCount = allRows.filter((row) => !row.isTestnet).length;
  const testnetCount = visibleTargetCount - mainnetCount;
  // The active network being a testnet forces them visible — never hide the
  // row the user is currently on. Search reveals testnets too, so a query can
  // jump straight to one ("sep" → Sepolia) even while the list is collapsed.
  const activeIsTestnet = allRows.some((row) => row.isActive && row.isTestnet);
  const searching = query.trim().length > 0;
  const testnetsExpanded = showTestnets || activeIsTestnet || searching;
  const showSearch = mainnetCount > SEARCH_VISIBLE_THRESHOLD;
  // The toggle is redundant while searching (search surfaces testnets) and when
  // the active network is itself a testnet (they're already shown, unhideable).
  const showTestnetToggle = testnetCount > 0 && !searching && !activeIsTestnet;

  if (visibleTargetCount <= 1) {
    return null;
  }

  const applyTarget = async (target: AomiNetworkTarget) => {
    if (!canActivateWallet()) return;
    if (adapter.selectNetwork) {
      await adapter.selectNetwork(target);
    }
    setOpen(false);
  };

  const handleTargetSelect = async (target: AomiNetworkTarget) => {
    if (
      target.family === "svm" &&
      adapter.solanaNetworkSwitchRequiresReconnect &&
      activeSolanaNetwork &&
      activeSolanaNetwork.id !== target.networkId
    ) {
      setPendingTarget(target);
      setConfirmOpen(true);
      return;
    }

    await applyTarget(target);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    // Reset the search each time the popover closes so it reopens clean.
    if (!next) setQuery("");
  };

  const toggleTestnets = () => {
    setShowTestnets((current) => {
      const next = !current;
      writeShowTestnetsPref(next);
      return next;
    });
  };

  const renderRow = (row: NetworkRow) => {
    if (row.isTestnet && !testnetsExpanded) return null;
    return (
      <CommandItem
        key={row.key}
        value={row.searchValue}
        onSelect={() => void handleTargetSelect(row.target)}
        className={cn(
          "flex items-center gap-2 rounded-lg px-2 py-1.5",
          row.isActive && "bg-accent",
        )}
      >
        <span
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-medium uppercase",
            // Lighter rows: only the live network carries a filled chip; the
            // rest show a bare brand mark so the list reads as one clean column
            // instead of a stack of grey boxes.
            row.isActive
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground",
          )}
        >
          {row.Icon ? <row.Icon className="h-4 w-4" /> : row.fallback}
        </span>
        <span className="min-w-0 flex-1 truncate">{row.title}</span>
        {row.isActive && (
          <CheckIcon className="text-primary h-4 w-4 shrink-0" />
        )}
      </CommandItem>
    );
  };

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            role="combobox"
            aria-expanded={open}
            data-aomi-network-select-trigger
            disabled={!adapter.selectNetwork}
            className={cn(
              "h-8 w-auto min-w-0 justify-between gap-px rounded-full px-0.5 text-xs md:min-w-[80px] md:gap-1.5 md:px-3",
              // Keep text + brand marks muted on hover (the marks inherit
              // currentColor, so hover:text-accent-foreground turned solid
              // logos like Base near-black); only the background highlights.
              "text-muted-foreground hover:bg-accent",
              !adapter.selectNetwork && "cursor-not-allowed opacity-50",
              className,
            )}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              {triggerChips.length === 0 ? (
                <span className="truncate">Network</span>
              ) : (
                triggerChips.map((chip, index) => (
                  <span key={chip.family} className="flex items-center gap-1.5">
                    {index > 0 && (
                      <span
                        className="text-muted-foreground/40"
                        aria-hidden="true"
                      >
                        /
                      </span>
                    )}
                    {chip.Icon && (
                      <chip.Icon className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className="truncate">{chip.label}</span>
                  </span>
                ))
              )}
            </span>
            <ChevronDownIcon className="ml-1 h-3 w-3 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={4}
          className="w-[260px] overflow-hidden rounded-xl p-0"
          onOpenAutoFocus={(event) => {
            if (
              typeof window.matchMedia === "function" &&
              window.matchMedia("(max-width: 767px)").matches
            ) {
              event.preventDefault();
            }
          }}
        >
          <Command className="rounded-xl">
            {showSearch && (
              <CommandInput
                placeholder="Search networks..."
                value={query}
                onValueChange={setQuery}
              />
            )}
            <CommandList className="max-h-[300px] p-1">
              <CommandEmpty>No networks found.</CommandEmpty>
              {sections.map((section) => (
                <CommandGroup
                  key={section.family}
                  heading={
                    showGroupHeaders ? familyLabel(section.family) : undefined
                  }
                  className="p-0"
                >
                  {section.rows.map(renderRow)}
                </CommandGroup>
              ))}
            </CommandList>
            {showTestnetToggle && (
              <button
                type="button"
                onClick={toggleTestnets}
                className="text-muted-foreground hover:bg-accent flex w-full items-center justify-between gap-2 border-t px-3 py-2 text-xs transition-colors"
              >
                <span>
                  {testnetsExpanded ? "Hide testnets" : "Show testnets"}
                </span>
                <span className="flex items-center gap-1">
                  {!testnetsExpanded && <span>{testnetCount} hidden</span>}
                  <ChevronDownIcon
                    className={cn(
                      "h-3.5 w-3.5 transition-transform",
                      testnetsExpanded && "rotate-180",
                    )}
                  />
                </span>
              </button>
            )}
          </Command>
        </PopoverContent>
      </Popover>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Switch SVM network?</DialogTitle>
            <DialogDescription>
              This SVM wallet needs to reconnect to change clusters. Your
              current chat and EVM wallet stay connected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setConfirmOpen(false);
                setPendingTarget(null);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                const target = pendingTarget;
                setConfirmOpen(false);
                setPendingTarget(null);
                if (target) {
                  void applyTarget(target);
                }
              }}
            >
              Switch Network
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
