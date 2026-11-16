"use client";

import type { AomiPackage, AomiPackageFamily } from "@aomi-labs/client";
import { useOptionalAomiRuntime } from "@aomi-labs/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Library } from "lucide-react";
import { useShellAomi } from "@/account/transport";
import { useAccountOverview } from "@/account/account-overview";
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
import { usePackageCatalog } from "./use-package-catalog";
import {
  FAMILIES,
  GROUP_TITLES,
  NAV_ITEMS,
  explainMutationError,
  groupPackages,
  inView,
  markNoticeSeen,
  matches,
  noticeSeen,
  type LibraryView,
} from "./model";
import { CatalogRow } from "./catalog-row";
import { SearchField, EmptyList } from "./navigation";

interface PackagesModalProps {
  onClose: () => void;
}

export function PackagesModal({ onClose }: PackagesModalProps) {
  const aomi = useShellAomi();
  const accountUserId = useAccountOverview()?.user.user_id;
  const threadId = useOptionalAomiRuntime()?.currentThreadId;
  const {
    catalog,
    error: loadError,
    refetch,
  } = usePackageCatalog(accountUserId, threadId);
  const [view, setView] = useState<LibraryView>("all");
  const [family, setFamily] = useState<AomiPackageFamily | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [noticeRow, setNoticeRow] = useState<AomiPackage | null>(null);
  const desktop = useDesktopLayout();
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const signedIn = accountUserId != null;
  const agent = catalog?.agent.display_name ?? "Your agent";
  const rows = useMemo(() => catalog?.packages ?? [], [catalog]);
  const groups = useMemo(
    () =>
      groupPackages(
        rows.filter((row) => matches(row, { view, family, query })),
      ),
    [rows, view, family, query],
  );
  const visible = groups.flatMap((group) => group.rows);
  const selected =
    visible.find((row) => row.package_id === selectedId) ?? visible[0] ?? null;

  /** Run one mutation, then read the rows again; errors stay in place. */
  const mutate = useCallback(
    async (row: AomiPackage, change: () => Promise<unknown>) => {
      if (busyId !== null) return false;
      setBusyId(row.package_id);
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
  const toggle = (row: AomiPackage, enabled: boolean) => {
    if (enabled && !noticeSeen(row)) setNoticeRow(row);
    else setChoice(row, enabled);
  };
  const open = (row: AomiPackage) => {
    setSelectedId(row.package_id);
    setMobileDetailOpen(true);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (noticeRow) return;
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
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, noticeRow]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [view, family, query]);

  const loading = catalog === null && !loadError;
  const count = (predicate: (row: AomiPackage) => boolean) =>
    loading ? ("loading" as const) : rows.filter(predicate).length;
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
      inspector
    >
      <ModalSidebar
        title="Library"
        titleId="library-title"
        icon={Library}
        className={mobileDetailOpen ? "max-md:hidden" : undefined}
      >
        <ModalNav label="Library sections" className="mt-2 md:mt-3">
          {NAV_ITEMS.map((item) => (
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
        <div className="border-aomi-border mt-2 md:mt-5 md:border-t md:pt-4">
          <span className="type-eyebrow text-aomi-muted hidden px-2.5 md:block">
            Ecosystem
          </span>
          <ModalNav label="Library ecosystems" className="mt-2">
            {FAMILIES.map((item) => (
              <ModalNavItem
                key={item.id}
                label={item.label}
                icon={item.icon}
                active={family === item.id}
                onClick={() =>
                  pick(() =>
                    setFamily((current) =>
                      current === item.id ? null : item.id,
                    ),
                  )
                }
                count={count((row) => row.families.includes(item.id))}
              />
            ))}
          </ModalNav>
        </div>
      </ModalSidebar>

      <main
        className={`flex min-h-0 min-w-0 flex-col p-4 ${mobileDetailOpen ? "max-md:hidden" : ""}`}
      >
        <SearchField
          query={query}
          onQueryChange={(next) => pick(() => setQuery(next))}
          searchRef={searchRef}
        />
        {actionError ? (
          <p
            role="alert"
            className="bg-aomi-surface-2 text-aomi-danger rounded-control type-meta mt-3 px-3 py-2 max-md:hidden"
          >
            {actionError}
          </p>
        ) : null}
        <div ref={listRef} className="mt-2 min-h-0 flex-1 overflow-y-auto">
          {loadError ? (
            <div className="type-meta flex min-h-44 flex-col items-center justify-center gap-3 text-center">
              <p className="text-aomi-muted">{loadError}</p>
              <AomiButton variant="primary" onClick={() => void refetch()}>
                Retry
              </AomiButton>
            </div>
          ) : loading ? (
            <LoadingPane label="Loading library" className="h-full" />
          ) : visible.length === 0 ? (
            <EmptyList />
          ) : (
            groups.map(({ group, rows: members }) => (
              <section key={group} aria-label={GROUP_TITLES[group](agent)}>
                <SectionHeader
                  as="h2"
                  title={GROUP_TITLES[group](agent)}
                  count={members.length}
                  className="mt-4 px-1"
                />
                <div className="mt-1 space-y-0.5">
                  {members.map((row) => (
                    <CatalogRow
                      key={row.package_id}
                      row={row}
                      selected={selected?.package_id === row.package_id}
                      busy={busyId === row.package_id}
                      disabled={!signedIn || busyId !== null}
                      onSelect={() => open(row)}
                      onToggle={(enabled) => toggle(row, enabled)}
                      onConnect={() => open(row)}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </main>

      <div
        className={
          mobileDetailOpen
            ? "bg-aomi-raised absolute inset-0 z-10 flex min-h-0 flex-col md:static md:z-auto"
            : "hidden min-h-0 md:flex md:flex-col"
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
        {desktop || mobileDetailOpen ? (
          <LibraryDetailPanel
            row={loading ? null : selected}
            agent={agent}
            signedIn={signedIn}
            busy={selected !== null && busyId === selected.package_id}
            error={desktop ? null : actionError}
            onToggle={toggle}
            onClearChoice={(row) =>
              void mutate(row, () =>
                aomi.account.packages.clearChoice(row.package_id),
              )
            }
            onSaveKey={(row, slot, value) =>
              mutate(row, () =>
                aomi.account.packages.setSecret(row.package_id, slot, value),
              )
            }
            onRemoveKey={(row, slot) =>
              mutate(row, () =>
                aomi.account.packages.clearSecret(row.package_id, slot),
              )
            }
          />
        ) : null}
      </div>

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
