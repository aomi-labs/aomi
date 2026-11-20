"use client";

import type { AomiPackage, AomiPublicPackage } from "@aomi-labs/client";
import { useOptionalAomiRuntime } from "@aomi-labs/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Library, Plus } from "lucide-react";
import { useShellAomi } from "@/account/transport";
import { useAccountOverview } from "@/account/account-overview";
import { useAomiWalletKit } from "@/wallet/context";
import { LoadingPane } from "@/ui/aomi/loading-pane";
import { AomiButton } from "@/ui/aomi/button";
import {
  ModalNav,
  ModalNavItem,
  ModalShell,
  ModalSidebar,
} from "@/ui/aomi/modal-shell";
import { SectionHeader } from "@/ui/aomi/section-header";
import { LibraryDetailPanel } from "./library-detail-panel";
import { PackageNotice } from "./package-notice";
import { AddWithCodeSheet, ConnectSheet } from "./package-sheets";
import { usePackageCatalog } from "./use-package-catalog";
import {
  GUEST_VIEWS,
  GROUP_TITLES,
  NAV_ITEMS,
  explainActivateError,
  explainMutationError,
  groupPackages,
  inView,
  markNoticeSeen,
  matches,
  networkItems,
  noticeSeen,
  personSlots,
  tagItems,
  type FilterItem,
  type LibraryView,
  type LoadFailure,
} from "./model";
import { CatalogRow } from "./catalog-row";
import { SearchField, EmptyList } from "./navigation";

interface PackagesModalProps {
  onClose: () => void;
}

export function PackagesModal({ onClose }: PackagesModalProps) {
  const aomi = useShellAomi();
  const accountUserId = useAccountOverview()?.user.user_id;
  const runtime = useOptionalAomiRuntime();
  // A chat the server has not stored yet has no agent to read; the Library
  // then shows `aomi/main`, as it does without a chat.
  const threadId =
    runtime && runtime.isRemoteThread?.(runtime.currentThreadId)
      ? runtime.currentThreadId
      : undefined;
  const {
    rows: loaded,
    agent,
    failure,
    refetch,
  } = usePackageCatalog(accountUserId, threadId);
  const wallet = useAomiWalletKit();
  const [view, setView] = useState<LibraryView>("all");
  const [chain, setChain] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [noticeRow, setNoticeRow] = useState<AomiPackage | null>(null);
  const [codeOpen, setCodeOpen] = useState(false);
  const [keysRow, setKeysRow] = useState<AomiPackage | null>(null);
  const desktop = useDesktopLayout();
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const signedIn = accountUserId != null;
  const rows = useMemo(() => loaded ?? [], [loaded]);
  const groups = useMemo(() => {
    const shown = rows.filter((row) =>
      matches(row, { view, chain, tag, query }),
    );
    // "To connect" is one list; a search looks across every group.
    return view === "connect" && !query.trim() && shown.length
      ? [{ group: "connect" as const, rows: shown }]
      : groupPackages(shown);
  }, [rows, view, chain, tag, query]);
  // The detail panel shows the chosen package, else the first one listed. It
  // reads every row, so a package that leaves the view after a change stays.
  const selected =
    rows.find((row) => row.id === selectedId) ?? groups[0]?.rows[0] ?? null;
  const inspector = selected !== null && desktop;

  /** Run one mutation, then read the rows again; errors stay in place. */
  const mutate = useCallback(
    async (row: AomiPackage, change: () => Promise<unknown>) => {
      if (busyId !== null) return false;
      setBusyId(row.id);
      setActionError(null);
      try {
        await change();
        await refetch();
        return true;
      } catch (cause) {
        setActionError(explainMutationError(cause, agent));
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [agent, busyId, refetch],
  );

  const setChoice = (row: AomiPackage, enabled: boolean) =>
    void mutate(row, () =>
      aomi.account.packages.setChoice(row.package_id, enabled),
    );
  /** A not verified package shows its notice before it first turns on. */
  const toggle = (row: AomiPackage, enabled: boolean) => {
    if (enabled && !row.verified && !noticeSeen(row)) setNoticeRow(row);
    else setChoice(row, enabled);
  };
  const saveKeys = (row: AomiPackage, values: [string, string][]) =>
    mutate(row, async () => {
      for (const [slot, value] of values)
        await aomi.account.packages.setSecret(row.package_id, slot, value);
    });
  const disconnect = (row: AomiPackage) =>
    void mutate(row, async () => {
      for (const slot of personSlots(row))
        if (slot.status === "ready")
          await aomi.account.packages.clearSecret(row.package_id, slot.name);
    });
  /** Redeem a private package code; the row appears and its detail opens. */
  const activate = async (code: string) => {
    try {
      const row = await aomi.account.packages.activate(code);
      await refetch();
      setView("all");
      setChain(null);
      setTag(null);
      setQuery("");
      setCodeOpen(false);
      open(row);
      return null;
    } catch (cause) {
      return explainActivateError(cause);
    }
  };
  function open(row: AomiPublicPackage) {
    setSelectedId(row.id);
    setMobileDetailOpen(true);
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (noticeRow || codeOpen || keysRow) return;
      if (event.key === "Escape") {
        onClose();
        return;
      }
      const typingElsewhere =
        event.target instanceof HTMLElement &&
        ["INPUT", "TEXTAREA"].includes(event.target.tagName);
      const wantsSearch =
        event.key === "/" ||
        (event.key === "k" && (event.metaKey || event.ctrlKey));
      if (wantsSearch && !typingElsewhere) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    // Capture runs before a sheet's own Escape closes it and re-renders this
    // effect, so an Escape meant for the sheet never reaches the Library.
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose, noticeRow, codeOpen, keysRow]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [view, chain, tag, query]);

  const loading = loaded === null && !failure;
  const count = (predicate: (row: AomiPublicPackage) => boolean) =>
    failure
      ? undefined
      : loading
        ? ("loading" as const)
        : rows.filter(predicate).length;
  const pick = (next: () => void) => {
    next();
    setSelectedId(null);
  };

  return (
    <ModalShell
      labelledBy="library-title"
      dismissLabel="Dismiss library"
      closeLabel="Close library"
      onClose={onClose}
      wide
      inspector={inspector}
    >
      <ModalSidebar
        title="Library"
        titleId="library-title"
        icon={Library}
        className={mobileDetailOpen ? "max-md:hidden" : undefined}
      >
        <ModalNav label="Library sections" className="mt-2 md:mt-3">
          {NAV_ITEMS.filter(
            (item) => signedIn || GUEST_VIEWS.includes(item.id),
          ).map((item) => (
            <ModalNavItem
              key={item.id}
              label={item.label}
              icon={item.icon}
              active={view === item.id}
              onClick={() => pick(() => setView(item.id))}
              count={count((row) => inView(row, item.id))}
            />
          ))}
        </ModalNav>
        <FilterNav
          title="Networks"
          label="Library networks"
          items={networkItems(rows)}
          active={chain}
          onPick={(id) => pick(() => setChain(id))}
          count={(id) => count((row) => row.chains.includes(id))}
        />
        <FilterNav
          title="Tags"
          label="Library tags"
          items={tagItems(rows)}
          active={tag}
          onPick={(id) => pick(() => setTag(id))}
          count={(id) => count((row) => row.tags.includes(id))}
        />
      </ModalSidebar>

      <main
        className={`flex min-h-0 min-w-0 flex-col p-4 ${mobileDetailOpen ? "max-md:hidden" : ""}`}
      >
        <div
          className={`flex min-w-0 items-center gap-2 ${inspector ? "" : "md:mr-10"}`}
        >
          <div className="min-w-0 flex-1">
            <SearchField
              query={query}
              onQueryChange={(next) => pick(() => setQuery(next))}
              searchRef={searchRef}
            />
          </div>
          {signedIn ? (
            <AomiButton
              className="h-9 pl-2.5"
              disabled={busyId !== null}
              onClick={() => setCodeOpen(true)}
            >
              <Plus /> <span className="max-md:sr-only">Add custom</span>
            </AomiButton>
          ) : null}
        </div>
        {signedIn ? null : (
          <div className="bg-aomi-surface-2 rounded-control mt-3 flex min-h-8 items-center justify-between gap-3 py-1 pl-3 pr-1 md:hidden">
            <span className="type-meta text-aomi-muted">
              Sign in to turn packages on and add your own
            </span>
            <AomiButton size="sm" onClick={() => void wallet.connect?.()}>
              Sign in
            </AomiButton>
          </div>
        )}
        {actionError ? (
          <p
            role="alert"
            className="bg-aomi-surface-2 text-aomi-danger rounded-control type-meta mt-3 px-3 py-2 max-md:hidden"
          >
            {actionError}
          </p>
        ) : null}
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
          {failure ? (
            <LoadFailureNotice
              failure={failure}
              onSignIn={() => void wallet.connect?.()}
              onRetry={() => void refetch()}
            />
          ) : loading ? (
            <LoadingPane label="Loading library" className="h-full" />
          ) : groups.length === 0 ? (
            <EmptyList />
          ) : (
            groups.map(({ group, rows: members }, index) => (
              <section
                key={group}
                aria-label={GROUP_TITLES[group](agent)}
                className={
                  index === 0 ? "mt-4" : "border-aomi-border mt-3 border-t pt-3"
                }
              >
                <SectionHeader
                  as="h2"
                  title={GROUP_TITLES[group](agent)}
                  count={members.length}
                  className="px-1"
                />
                <div className="mt-2 space-y-0.5">
                  {members.map((row) => (
                    <CatalogRow
                      key={row.id}
                      row={row}
                      selected={inspector && selected?.id === row.id}
                      onSelect={() => open(row)}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </main>

      {selected && (inspector || mobileDetailOpen) ? (
        <div
          className={
            mobileDetailOpen
              ? "bg-aomi-raised absolute inset-0 z-10 flex min-h-0 flex-col md:static md:z-auto"
              : "flex min-h-0 flex-col"
          }
        >
          <button
            type="button"
            onClick={() => setMobileDetailOpen(false)}
            className="border-aomi-border type-control flex shrink-0 items-center gap-2 border-b px-4 py-4 pr-14 md:hidden"
          >
            <ArrowLeft className="size-4" />
            Back to library
          </button>
          <LibraryDetailPanel
            key={selected.id}
            row={selected}
            busy={busyId === selected.id}
            error={desktop ? null : actionError}
            onToggle={toggle}
            onConnect={setKeysRow}
            onDisconnect={disconnect}
            onSignIn={() => void wallet.connect?.()}
          />
        </div>
      ) : null}

      {codeOpen ? (
        <AddWithCodeSheet
          onActivate={activate}
          onClose={() => setCodeOpen(false)}
        />
      ) : null}
      {keysRow ? (
        <ConnectSheet
          row={keysRow}
          onSave={(values) => saveKeys(keysRow, values)}
          onClose={() => setKeysRow(null)}
        />
      ) : null}

      <PackageNotice
        row={noticeRow}
        onCancel={() => setNoticeRow(null)}
        onConfirm={(row) => {
          markNoticeSeen(row);
          setNoticeRow(null);
          setChoice(row, true);
        }}
      />
    </ModalShell>
  );
}

const FAILURE_COPY: Record<
  LoadFailure,
  { title: string; body: string; action: string }
> = {
  session_ended: {
    title: "Your session ended",
    body: "Sign in again to see your Library.",
    action: "Sign in again",
  },
  failed: {
    title: "Couldn’t load your Library",
    body: "Something went wrong. Please try again.",
    action: "Retry",
  },
};

/** An ended session asks to sign in again; only a real failure retries. */
/** One sidebar filter; picking the active item again clears it. Empty lists are hidden. */
function FilterNav({
  title,
  label,
  items,
  active,
  onPick,
  count,
}: {
  title: string;
  label: string;
  items: FilterItem[];
  active: string | null;
  onPick: (id: string | null) => void;
  count: (id: string) => number | "loading" | undefined;
}) {
  if (!items.length) return null;
  return (
    <div className="border-aomi-border mt-2 md:mt-5 md:border-t md:pt-4">
      <span className="type-meta text-aomi-muted hidden px-2.5 font-medium md:block">
        {title}
      </span>
      <ModalNav label={label} className="mt-2">
        {items.map((item) => (
          <ModalNavItem
            key={item.id}
            label={item.label}
            icon={item.icon}
            active={active === item.id}
            onClick={() => onPick(active === item.id ? null : item.id)}
            count={count(item.id)}
          />
        ))}
      </ModalNav>
    </div>
  );
}

function LoadFailureNotice({
  failure,
  onSignIn,
  onRetry,
}: {
  failure: LoadFailure;
  onSignIn: () => void;
  onRetry: () => void;
}) {
  const copy = FAILURE_COPY[failure];
  return (
    <div className="flex min-h-44 flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="type-row text-aomi-fg">{copy.title}</span>
      <span className="type-meta text-aomi-muted max-w-sm">{copy.body}</span>
      <AomiButton
        variant="primary"
        onClick={failure === "failed" ? onRetry : onSignIn}
      >
        {copy.action}
      </AomiButton>
    </div>
  );
}

const DESKTOP_QUERY = "(min-width: 768px)";

/** Whether the md layout shows the detail panel beside the list. */
function useDesktopLayout(): boolean {
  const [desktop, setDesktop] = useState(
    () =>
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function" ||
      window.matchMedia(DESKTOP_QUERY).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(DESKTOP_QUERY);
    const update = () => setDesktop(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return desktop;
}
