"use client";

import { cn } from "@/lib/cn";
import { useState, type ReactNode } from "react";
import {
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  Lock,
  Search,
  SquarePen,
  UserCheck,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { shortAddress, type AomiLane } from "@aomi-labs/client";
import { ListGroup, ListRow } from "@/ui/aomi/list-group";
import { SectionHeader } from "@/ui/aomi/section-header";
import { aomiButton } from "@/ui/aomi/button";
import { StatusPill } from "@/ui/aomi/status-pill";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import {
  ControlMenuCheck,
  ControlMenuTitle,
  ControlSelectChevron,
  controlMenuContentClass,
  controlMenuIconClass,
  controlMenuItemClass,
  controlSelectTriggerClass,
} from "@/controls/control-menu";
import { BrandMark } from "@/account/account-management/controls";

/** One wallet of the account, as the wallet view lists it. */
export type WalletViewRow = {
  /** An agent wallet's id; for another wallet a stable key of its own. */
  id: string;
  name: string;
  kind: "agent" | "sign-in";
  /** `AGENT_WALLET`, or the wallet app (`Privy`, `MetaMask`). */
  brand: string;
  addresses: readonly { family: "evm" | "svm"; address: string }[];
  /** The app an agent wallet was made in. */
  app?: string | null;
  paused?: boolean;
  /** Not made yet: shown until consent creates it. */
  pending?: ReactNode;
};

type LaneOption = {
  id: AomiLane;
  label: string;
  description: string;
  Icon: LucideIcon;
};

/**
 * The choices a connection has on an agent wallet. The portal is the owner:
 * it always approves, so it picks only between Ask and Instant.
 */
function laneOptions(client: string, portal = false): LaneOption[] {
  const instant: LaneOption = {
    id: "instant",
    label: "Instant",
    description: "Signs at once, nobody approves",
    Icon: Zap,
  };
  if (portal)
    return [
      {
        id: "here",
        label: "Ask",
        description: "You approve each trade",
        Icon: UserCheck,
      },
      instant,
    ];
  return [
    {
      id: "portal",
      label: "Ask on Aomi",
      description: "You approve each trade in Aomi",
      Icon: UserCheck,
    },
    {
      id: "here",
      label: `Ask in ${client}`,
      description: `${client} can approve its own trades`,
      Icon: BadgeCheck,
    },
    instant,
  ];
}

/** The pill the lane picker and the fixed lane share. */
const lanePill = cn(
  controlSelectTriggerClass,
  "border-aomi-border bg-aomi-raised inline-flex shrink-0 items-center border",
);

/** The composer's guard-policy menu, as a row's lane picker. */
export function LaneSelect({
  wallet,
  client,
  lane,
  portal = false,
  askOnly = false,
  disabled = false,
  onChange,
}: {
  wallet: string;
  /** The connection's name, for "Ask in <client>". */
  client: string;
  lane: AomiLane;
  portal?: boolean;
  /** Every trade waits for the owner: the lane is fixed at Ask on Aomi. */
  askOnly?: boolean;
  disabled?: boolean;
  onChange: (lane: AomiLane) => void;
}) {
  const [open, setOpen] = useState(false);
  const options = laneOptions(client, portal);
  const current = options.find((option) => option.id === lane) ?? options[0]!;
  if (askOnly)
    return (
      <span className={cn(lanePill, "pointer-events-none")}>
        <Lock className="h-3 w-3 shrink-0 opacity-60" />
        <span className="truncate">{options[0]!.label}</span>
      </span>
    );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label={`${wallet}: ${current.label}`}
          disabled={disabled}
          className={cn(lanePill, lane !== options[0]!.id && "text-aomi-fg")}
        >
          <current.Icon
            className={cn(
              "h-3 w-3 shrink-0",
              lane === options[0]!.id && "opacity-60",
            )}
          />
          <span className="truncate">{current.label}</span>
          <ControlSelectChevron />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={4}
        avoidCollisions
        collisionPadding={8}
        onOpenAutoFocus={(event) => event.preventDefault()}
        // Above the sheet it opens in, like the rows' ⋯ menus.
        className={cn(controlMenuContentClass, "z-[90]")}
      >
        <ControlMenuTitle>Trades from {wallet}</ControlMenuTitle>
        <div className="space-y-0.5">
          {options.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={item.id === lane}
              onClick={() => {
                setOpen(false);
                if (item.id !== lane) onChange(item.id);
              }}
              className={cn(controlMenuItemClass, "hover:bg-aomi-hover")}
            >
              <span className={controlMenuIconClass}>
                <item.Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium">
                  {item.label}
                </span>
                <span className="text-aomi-muted block text-[11px] leading-4">
                  {item.description}
                </span>
              </span>
              <ControlMenuCheck selected={item.id === lane} />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * A wallet Aomi holds no key for: every trade is signed in that wallet. The
 * lane picker's pill, without a chevron, and not a control.
 */
export function FixedLane({ brand }: { brand: string }) {
  return (
    <span className={cn(lanePill, "pointer-events-none")}>
      <SquarePen className="h-3 w-3 shrink-0 opacity-60" />
      <span className="truncate">Sign in {brand}</span>
    </span>
  );
}

/** "1–3 of 6" with ‹ ›, for a SectionHeader's action. */
export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1) return null;
  const from = page * pageSize + 1;
  const to = Math.min(total, from + pageSize - 1);
  return (
    <div className="flex items-center gap-0.5">
      <span className="type-meta text-aomi-muted mr-1 tabular-nums">
        {from}–{to} of {total}
      </span>
      <button
        type="button"
        aria-label="Previous page"
        disabled={page === 0}
        onClick={() => onPage(page - 1)}
        className={aomiButton({ variant: "ghost", size: "icon-sm" })}
      >
        <ChevronLeft className="size-4" />
      </button>
      <button
        type="button"
        aria-label="Next page"
        disabled={page >= pages - 1}
        onClick={() => onPage(page + 1)}
        className={aomiButton({ variant: "ghost", size: "icon-sm" })}
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

/** A page of `items`, clamped as the list shrinks. */
export function usePage<T>(items: readonly T[], pageSize: number) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const at = Math.min(page, pages - 1);
  return {
    page: at,
    setPage,
    shown: items.slice(at * pageSize, at * pageSize + pageSize),
  };
}

/** A filter chip, as on the usage statement. */
export function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-[5px] text-xs transition-colors",
        active
          ? "bg-aomi-surface-2 text-aomi-fg border-transparent font-medium"
          : "border-aomi-border text-aomi-muted hover:text-aomi-fg",
      )}
    >
      {children}
    </button>
  );
}

const addressLine = (row: WalletViewRow) =>
  row.addresses.map((entry) => shortAddress(entry.address)).join(" · ") +
  (row.addresses.length === 1
    ? ` · ${row.addresses[0]!.family.toUpperCase()}`
    : "");

const KINDS = { agent: "Agent", "sign-in": "Sign-in" } as const;

/** Rows a page in the wallet view and a wallet's "Who can use it". */
export const PAGE_SIZE = 3;
/** Wallet count past which the wallet view offers search. */
const SEARCH_FROM = 5;

/**
 * Every wallet the account has, as one connection sees it: search (past
 * five wallets), kind chips, three rows a page, and each agent wallet's lane
 * picker. Wallets Aomi holds no key for show their fixed lane.
 */
export function WalletView({
  rows,
  client,
  lanes,
  onLane,
  portal = false,
  askOnly = false,
  disabled = false,
  title = "Your wallets",
  detail,
}: {
  rows: readonly WalletViewRow[];
  /** The connection's name, for "Ask in <client>". */
  client: string;
  /** Each agent wallet's lane, by row id. */
  lanes: Readonly<Record<string, AomiLane>>;
  onLane: (row: WalletViewRow, lane: AomiLane) => void;
  portal?: boolean;
  askOnly?: boolean;
  disabled?: boolean;
  title?: string;
  detail?: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [picked, setKind] = useState<WalletViewRow["kind"] | "all">("all");
  const kinds = [...new Set(rows.map((row) => row.kind))];
  // A chip whose kind is gone falls back to All.
  const kind = picked !== "all" && kinds.includes(picked) ? picked : "all";
  const q = query.trim().toLowerCase();
  const matches = rows.filter(
    (row) =>
      (kind === "all" || row.kind === kind) &&
      (!q ||
        row.name.toLowerCase().includes(q) ||
        row.addresses.some((entry) => entry.address.toLowerCase().includes(q))),
  );
  const { page, setPage, shown } = usePage(matches, PAGE_SIZE);
  return (
    <section className="flex w-full flex-col gap-2" data-wallet-view>
      <SectionHeader
        title={title}
        count={rows.length}
        detail={detail}
        action={
          <Pager
            page={page}
            pageSize={PAGE_SIZE}
            total={matches.length}
            onPage={setPage}
          />
        }
      />
      {rows.length > SEARCH_FROM ? (
        <label className="bg-aomi-surface-2/55 flex h-8 items-center gap-[7px] rounded-lg px-2.5">
          <Search className="text-aomi-muted size-3.5 shrink-0" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            aria-label="Search wallets"
            placeholder="Search wallets or addresses..."
            className="placeholder:text-aomi-muted min-w-0 flex-1 bg-transparent text-xs outline-none"
          />
        </label>
      ) : null}
      {kinds.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterChip
            active={kind === "all"}
            onClick={() => {
              setKind("all");
              setPage(0);
            }}
          >
            All
          </FilterChip>
          {kinds.map((entry) => (
            <FilterChip
              key={entry}
              active={kind === entry}
              onClick={() => {
                setKind(entry);
                setPage(0);
              }}
            >
              {KINDS[entry]}
            </FilterChip>
          ))}
        </div>
      ) : null}
      <ListGroup>
        {shown.map((row) => (
          <ListRow
            key={row.id}
            data-wallet-row={row.id}
            className="sm:flex-nowrap"
            leading={
              <BrandMark
                brand={row.brand}
                dot={row.paused || row.pending ? "off" : "on"}
                dim={row.paused}
              />
            }
            title={
              <span className="flex min-w-0 items-baseline gap-1.5">
                <span className="truncate">{row.name}</span>
                {row.app ? (
                  <span className="type-meta text-aomi-muted shrink-0">
                    made in {row.app}
                  </span>
                ) : null}
              </span>
            }
            description={row.pending ?? addressLine(row)}
            descriptionMono={!row.pending}
            trailing={
              row.kind !== "agent" ? (
                <FixedLane brand={row.brand} />
              ) : row.paused ? (
                <StatusPill>Paused</StatusPill>
              ) : (
                <LaneSelect
                  wallet={row.name}
                  client={client}
                  lane={lanes[row.id] ?? "portal"}
                  portal={portal}
                  askOnly={askOnly}
                  disabled={disabled}
                  onChange={(lane) => onLane(row, lane)}
                />
              )
            }
          />
        ))}
        {shown.length === 0 ? (
          <p className="type-meta text-aomi-muted px-3.5 py-4">
            {rows.length ? `No wallet matches “${query}”.` : "No wallets yet."}
          </p>
        ) : null}
      </ListGroup>
    </section>
  );
}
