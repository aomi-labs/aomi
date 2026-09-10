"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Library, Loader2, X } from "lucide-react";
import { useAomiWalletKit } from "@aomi-labs/widget-lib";
import { ModalBackdrop } from "@/components/ui/modal-backdrop";
import { requestCapabilityMention } from "@/components/assistant-ui/capability-composer";
import {
  useSkillCatalog,
  type SkillSummary,
} from "@/lib/capabilities/skill-catalog";
import {
  updateAccountApps,
  useAccountOverview,
} from "@portal/lib/account-overview";
import {
  LibraryDetailPanel,
  type LibrarySelection,
} from "./library-detail-panel";
import { PINNED_APPS } from "./packages-catalog";
import { setInstalledApps } from "./packages-api";
import { usePackageCatalog } from "./use-package-catalog";
import { directoryModalType } from "./directory-modal-type";
import {
  NAV_ITEMS,
  CATEGORIES,
  selectionKey,
  useLibraryEntries,
  type LibraryView,
} from "./library/model";
import { CatalogRow } from "./library/catalog-row";
import { SearchField, SidebarButton, EmptyList } from "./library/navigation";

export { inferLibraryCategory } from "./library/model";

interface PackagesModalProps {
  onClose: () => void;
}

export function PackagesModal({ onClose }: PackagesModalProps) {
  const activeChainId = useAomiWalletKit().identity.chainId;
  const account = useAccountOverview();
  const {
    catalog,
    error: catalogError,
    retry: retryApps,
  } = usePackageCatalog(account?.user.user_id);
  const {
    skills,
    error: skillsError,
    retry: retrySkills,
    loading: skillsLoading,
  } = useSkillCatalog();
  const [view, setView] = useState<LibraryView>("discover");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<LibrarySelection | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const mutationInFlight = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const accountUserId = account?.user.user_id;
  const installedBaseline = account?.user.apps ?? null;
  const installedReady = installedBaseline !== null;
  const installedIds = useMemo(() => {
    const ids = new Set(installedBaseline ?? []);
    for (const pinned of PINNED_APPS) ids.add(pinned);
    return ids;
  }, [installedBaseline]);

  const mutateInstalled = useCallback(
    async (packageId: string, next: string[]) => {
      if (
        !installedReady ||
        !accountUserId ||
        mutationInFlight.current
      )
        return;
      mutationInFlight.current = true;
      setBusyId(packageId);
      setActionError(null);
      try {
        const apps = await setInstalledApps(next);
        updateAccountApps(accountUserId, apps);
      } catch (cause) {
        setActionError(
          cause instanceof Error ? cause.message : "Couldn’t update apps",
        );
      } finally {
        mutationInFlight.current = false;
        setBusyId(null);
      }
    },
    [accountUserId, installedReady],
  );

  const install = (packageId: string) => {
    void mutateInstalled(packageId, [
      ...[...installedIds].filter((id) => id !== packageId),
      packageId,
    ]);
  };
  const uninstall = (packageId: string) => {
    void mutateInstalled(
      packageId,
      [...installedIds].filter((id) => id !== packageId),
    );
  };
  const trySkill = (skill: SkillSummary) => {
    requestCapabilityMention({ kind: "skill", id: skill.id });
    onClose();
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
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
  }, [onClose]);

  const {
    appEntries,
    skillEntries,
    allEntries,
    categoryCounts,
    visible,
    listTitle,
  } = useLibraryEntries({ catalog, skills, installedIds, query, view });

  const activeSelection =
    selected &&
    visible.some((entry) => selectionKey(entry) === selectionKey(selected))
      ? selected
      : (visible[0] ?? null);
  const selectedInstalled =
    activeSelection?.kind === "app" &&
    installedIds.has(activeSelection.item.id);
  const waiting =
    view === "apps" || view === "installed"
      ? catalog === null
      : view === "skills"
        ? skillsLoading
        : catalog === null || skillsLoading;
  const loadError =
    view === "apps" || view === "installed"
      ? catalogError
      : view === "skills"
        ? skillsError
        : (catalogError ?? skillsError);

  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{ zIndex: 60 }}
    >
      <ModalBackdrop aria-label="Dismiss library" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-title"
        className="border-aomi-border bg-aomi-raised text-aomi-fg relative overflow-hidden rounded-[22px] border shadow-[0_24px_70px_rgba(0,0,0,0.08)]"
        style={{ width: 1080, height: 620, maxWidth: "96%", maxHeight: "92%" }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close library"
          className="text-aomi-muted hover:bg-aomi-hover hover:text-aomi-fg absolute right-4 top-4 z-20 flex size-7 items-center justify-center rounded-full transition-colors"
        >
          <X className="size-3.5" />
        </button>
        <div className="grid h-full min-h-0 md:grid-cols-[185px_minmax(0,1fr)_300px]">
          <aside className="border-aomi-border bg-aomi-bg/40 min-h-0 overflow-y-auto border-r p-3">
            <div className="flex items-center gap-2 px-2.5 py-3">
              <Library className="text-aomi-accent size-4" />
              <h1
                id="library-title"
                className={`flex-1 ${directoryModalType.modalTitle}`}
              >
                Library
              </h1>
            </div>
            <nav className="mt-3 space-y-0.5" aria-label="Library sections">
              {NAV_ITEMS.map((item) => (
                <SidebarButton
                  key={item.id}
                  label={item.label}
                  icon={item.icon}
                  active={view === item.id}
                  onClick={() => {
                    setView(item.id);
                    setSelected(null);
                  }}
                  count={
                    item.id === "discover"
                      ? allEntries.length
                      : item.id === "installed"
                        ? appEntries.filter((entry) =>
                            installedIds.has(entry.item.id),
                          ).length
                        : item.id === "apps"
                          ? appEntries.length
                          : skillEntries.length
                  }
                />
              ))}
            </nav>
            <div className="border-aomi-border mt-5 border-t pt-4">
              <span className="text-aomi-muted px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em]">
                Categories
              </span>
              <nav className="mt-2 space-y-0.5" aria-label="Library categories">
                {CATEGORIES.map((category) => (
                  <SidebarButton
                    key={category.id}
                    label={category.label}
                    icon={category.icon}
                    active={view === category.id}
                    onClick={() => {
                      setView(category.id);
                      setSelected(null);
                    }}
                    count={categoryCounts.get(category.id)}
                  />
                ))}
              </nav>
            </div>
          </aside>

          <main className="flex min-h-0 min-w-0 flex-col p-4">
            <SearchField
              query={query}
              onQueryChange={setQuery}
              searchRef={searchRef}
            />
            {actionError ? (
              <p className="bg-aomi-surface-2 text-aomi-danger mt-3 rounded-xl px-3 py-2 text-xs">
                {actionError}
              </p>
            ) : null}
            <div className="mt-4 flex items-center justify-between px-1">
              <h2 className={directoryModalType.sectionTitle}>{listTitle}</h2>
              <span className="text-aomi-muted font-mono text-[10px]">
                {visible.length}
              </span>
            </div>
            <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
              {loadError ? (
                <div className="flex min-h-44 flex-col items-center justify-center gap-3 text-center text-xs">
                  <p className="text-aomi-muted">{loadError}</p>
                  <button
                    type="button"
                    onClick={() => {
                      retryApps();
                      retrySkills();
                    }}
                    className="bg-aomi-fg text-aomi-bg rounded-full px-4 py-2 font-medium"
                  >
                    Retry
                  </button>
                </div>
              ) : waiting ? (
                <div className="text-aomi-muted flex min-h-44 items-center justify-center gap-2 text-xs">
                  <Loader2 className="size-3.5 animate-spin" /> Loading library…
                </div>
              ) : visible.length === 0 ? (
                <EmptyList />
              ) : (
                <div className="space-y-0.5">
                  {visible.map((entry) => (
                    <CatalogRow
                      key={selectionKey(entry)}
                      selection={entry}
                      selected={
                        activeSelection
                          ? selectionKey(activeSelection) ===
                            selectionKey(entry)
                          : false
                      }
                      installed={
                        entry.kind === "app" && installedIds.has(entry.item.id)
                      }
                      busy={entry.kind === "app" && busyId === entry.item.id}
                      disabled={!installedReady || busyId !== null}
                      activeChainId={activeChainId}
                      onSelect={() => setSelected(entry)}
                      onInstall={() =>
                        entry.kind === "app" && install(entry.item.id)
                      }
                      onTry={() =>
                        entry.kind === "skill" && trySkill(entry.item)
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          </main>

          <LibraryDetailPanel
            selection={activeSelection}
            installed={selectedInstalled}
            installedReady={installedReady}
            busy={
              activeSelection?.kind === "app" &&
              busyId === activeSelection.item.id
            }
            activeChainId={activeChainId}
            onInstall={install}
            onUninstall={uninstall}
            onTrySkill={trySkill}
          />
        </div>
      </div>
    </div>
  );
}
