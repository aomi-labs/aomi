"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
  type PointerEvent,
  type SVGProps,
} from "react";
import { cn } from "@aomi-labs/react";
import type { Chain } from "viem";
import { Sparkles } from "lucide-react";
import { Button } from "@/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/ui/popover";
import { getChainIcon } from "@/icons/chain-map";
import { SolanaIcon } from "@/icons/chain-icons";
import { useAomiWalletKit } from "@/wallet/context";
import { controlSelectTriggerClass } from "./control-menu";
import { evmNetworkDescription } from "./network-metadata";

export type NetworkSelectProps = {
  className?: string;
  chains?: readonly Chain[];
};

type GlyphIcon = FC<SVGProps<SVGSVGElement>>;

type Network = {
  key: string;
  name: string;
  description: string;
  Icon?: GlyphIcon;
  /** Two-letter mark when no brand icon exists. */
  fallback: string;
  isTestnet: boolean;
};

/** Logos shown in the closed pill; the rest live in the popover. */
const STACK_SIZE = 4;
/** Lets the pointer cross the gap between pill and popover without closing. */
const HOVER_CLOSE_DELAY_MS = 140;

/** Touch taps emit pointerenter before click; let click own open/close. */
const isTouch = (event: PointerEvent) =>
  event.pointerType === "touch" || event.pointerType === "pen";

/**
 * Aomi routes every action to its chain and bridges on its own, so this is a
 * showcase of supported networks rather than a switcher.
 */
export const NetworkSelect: FC<NetworkSelectProps> = ({
  className,
  chains,
}) => {
  const adapter = useAomiWalletKit();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const evmChains =
    chains ?? adapter.supportedNetworks?.evm ?? adapter.supportedChains ?? [];
  const solanaNetworks = adapter.supportedNetworks?.solana ?? [];

  const networks = useMemo<Network[]>(
    () => [
      ...evmChains.map((chain) => ({
        key: `evm:${chain.id}`,
        name: chain.name.replace(/ (Mainnet|One)$/, ""),
        description: evmNetworkDescription(chain),
        Icon: getChainIcon(chain.id),
        fallback: (chain.nativeCurrency?.symbol ?? chain.name).slice(0, 2),
        isTestnet: chain.testnet === true,
      })),
      ...solanaNetworks.map((network) => ({
        key: `solana:${network.id}`,
        name: network.label,
        description: "L1 · SOL",
        Icon: SolanaIcon,
        fallback: "SO",
        isTestnet: network.cluster !== "solana:mainnet",
      })),
    ],
    [evmChains, solanaNetworks],
  );
  const mainnets = networks.filter((network) => !network.isTestnet);
  const shown = mainnets.length > 0 ? mainnets : networks;
  // The pill always ends on Solana, when supported, so both families show.
  const solana = shown.find((network) => network.key.startsWith("solana:"));
  const stack = solana
    ? [
        ...shown
          .filter((network) => network !== solana)
          .slice(0, STACK_SIZE - 1),
        solana,
      ]
    : shown.slice(0, STACK_SIZE);
  const testnetCount = networks.length - mainnets.length;

  if (networks.length <= 1) return null;

  const hoverOpen = (event: PointerEvent) => {
    if (isTouch(event)) return;
    clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hoverClose = (event: PointerEvent) => {
    if (isTouch(event)) return;
    closeTimer.current = setTimeout(() => setOpen(false), HOVER_CLOSE_DELAY_MS);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          aria-label="Supported networks"
          data-aomi-network-select-trigger
          onPointerEnter={hoverOpen}
          onPointerLeave={hoverClose}
          className={cn(
            controlSelectTriggerClass,
            "group/networks w-auto justify-start",
            className,
          )}
        >
          <span className="flex items-center" aria-hidden="true">
            {stack.map((network, index) => (
              <span
                key={network.key}
                data-network={network.key}
                style={{
                  zIndex: STACK_SIZE - index,
                  // Keep closed geometry stable before hydration/CSS settles.
                  marginLeft: index > 0 ? (open ? -2 : -6) : undefined,
                }}
                className="bg-aomi-raised ring-aomi-bg relative flex size-4 items-center justify-center rounded-full text-[7px] font-semibold uppercase ring-2 transition-[margin] duration-300 ease-out motion-reduce:transition-none"
              >
                {network.Icon ? (
                  <network.Icon className="size-4" />
                ) : (
                  network.fallback
                )}
              </span>
            ))}
          </span>
          <span className="truncate">All networks</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        onPointerEnter={hoverOpen}
        onPointerLeave={hoverClose}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="border-aomi-border bg-aomi-raised w-[280px] overflow-hidden rounded-2xl border p-0 shadow-[0_16px_40px_rgba(0,0,0,0.20)]"
      >
        <div className="px-4 pb-3 pt-4">
          <p className="text-aomi-fg flex items-center gap-1.5 text-[13px] font-medium">
            <Sparkles className="text-aomi-accent size-3.5" />
            Every network, no switching
          </p>
          <p className="text-aomi-muted mt-1 text-[11.5px] leading-[1.45]">
            Just say where. Aomi runs each step on the right chain and bridges
            between them when it needs to.
          </p>
        </div>
        <ul
          aria-label="Supported networks"
          className="flex max-h-[248px] flex-wrap justify-center gap-1.5 overflow-y-auto overscroll-contain px-4 pb-4"
        >
          {shown.map((network, index) => (
            <li
              key={network.key}
              title={`${network.name} · ${network.description}`}
              style={{ animationDelay: `${Math.min(index, 12) * 22}ms` }}
              className="group/network border-aomi-border hover:border-aomi-fg/20 hover:bg-aomi-hover animate-in fade-in-0 zoom-in-95 fill-mode-both flex items-center gap-1.5 rounded-full border py-0.5 pl-1 pr-2.5 transition-colors duration-300 motion-reduce:animate-none motion-reduce:transition-none"
            >
              <span className="text-aomi-muted flex size-5 shrink-0 items-center justify-center text-[8px] font-semibold uppercase transition-transform duration-200 ease-out group-hover/network:rotate-[-8deg] group-hover/network:scale-110 motion-reduce:transition-none">
                {network.Icon ? (
                  <network.Icon className="size-4" />
                ) : (
                  network.fallback
                )}
              </span>
              <span className="text-aomi-fg whitespace-nowrap text-[11.5px]">
                {network.name}
              </span>
            </li>
          ))}
        </ul>
        {testnetCount > 0 && mainnets.length > 0 && (
          <p className="border-aomi-border text-aomi-muted border-t px-4 py-2 text-[11px]">
            Plus {testnetCount} {testnetCount === 1 ? "testnet" : "testnets"}{" "}
            for trying things out.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
};
