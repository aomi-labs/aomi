"use client";

import { useShellTransport } from "@/account/transport";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Library } from "lucide-react";
import { LoadingPane } from "@/ui/aomi/loading-pane";
import { useAomiWalletKit } from "@/wallet/context";
import { AomiButton } from "@/ui/aomi/button";
import {
  ModalNav,
  ModalNavItem,
  ModalShell,
  ModalSidebar,
} from "@/ui/aomi/modal-shell";
import { SectionHeader } from "@/ui/aomi/section-header";
import { requestCapabilityMention } from "@/composer/capability-composer/model";
import {
  useSkillCatalog,
  type SkillSummary,
} from "@/composer/capabilities/skill-catalog";
import {
  useAccountOverviewStore,
  useAccountOverview,
} from "@/account/account-overview";
import { LibraryDetailPanel } from "./library-detail-panel";
import {
  packageIdentityKey,
  PINNED_APPS,
  type CatalogPackage,
} from "./packages-catalog";
import { installApp, uninstallApp } from "@/account/shell/packages-api";
import { usePackageCatalog } from "./use-package-catalog";
import {
  NAV_ITEMS,
  CATEGORIES,
  selectionKey,
  selectionIsOfficial,
  useLibraryEntries,
  type LibraryView,
} from "./model";
import { CatalogRow } from "./catalog-row";
import { SearchField, EmptyList } from "./navigation";

export { inferLibraryCategory } from "./model";

interface PackagesModalProps {
  onClose: () => void;
}

export function PackagesModal({ onClose }: PackagesModalProps) {
  const transport = useShellTransport();
  const { updateAccountApps } = useAccountOverviewStore();
  const walletKit = useAomiWalletKit();
  // The networks this host routes to (what the network showcase lists), not
  // the wallet's current chain: installing needs only the application id.
  const hostChains =
    walletKit.supportedNetworks?.evm ?? walletKit.supportedChains;
  const hostChainIds = useMemo(
    () => (hostChains ?? []).map((chain) => chain.id),
    [hostChains],
  );
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
  } = useSkillCatalog(transport.json);
  const [view, setView] = useState<LibraryView>("discover");
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const mutationInFlight = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const accountUserId = account?.user.user_id;
  const installedReady = catalog !== null && accountUserId != null;
  const installedIds = useMemo(() => {
    const ids = new Set(
      (catalog ?? [])
        .filter((app) => app.installed || app.pinned)
        .map(packageIdentityKey),
    );
    for (const pinned of PINNED_APPS) ids.add(`name:${pinned}`);
    return ids;
  }, [catalog]);

  const mutateInstalled = useCallback(
    async (app: CatalogPackage, install: boolean) => {
      if (!installedReady || !accountUserId || mutationInFlight.current)
        return false;
      if (app.applicationId == null) {
        setActionError("This app does not expose an installable identity.");
        return false;
      }
      const packageId = packageIdentityKey(app);
      mutationInFlight.current = true;
      setBusyId(packageId);
      setActionError(null);
      try {
        const result = install
          ? await installApp(app.applicationId, transport.json)
          : await uninstallApp(app.applicationId, transport.json);
        const previousIds = account?.user.application_ids ?? [];
        const applicationId = Number(result.application_id);
        const applicationIds = install
          ? [...new Set([...previousIds, applicationId])]
          : previousIds.filter((id) => id !== applicationId);
        updateAccountApps(accountUserId, result.apps, applicationIds);
        retryApps();
        return true;
      } catch (cause) {
        setActionError(
          cause instanceof Error ? cause.message : "Couldn’t update apps",
        );
        return false;
      } finally {
        mutationInFlight.current = false;
        setBusyId(null);
      }
    },
    [
      account?.user.application_ids,
      accountUserId,
      installedReady,
      retryApps,
      transport,
      updateAccountApps,
    ],
  );

  const install = (app: CatalogPackage) => {
    return mutateInstalled(app, true);
  };
  const uninstall = (app: CatalogPackage) => {
    void mutateInstalled(app, false);
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
    visible.find((entry) => selectionKey(entry) === selectedKey) ??
    visible[0] ??
    null;
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [view, query]);
  const selectedInstalled =
    activeSelection?.kind === "app" &&
    installedIds.has(packageIdentityKey(activeSelection.item));
  // Apps and skills appear together: every count and list waits for both.
  const loading =
    (catalog === null && !catalogError) || (skillsLoading && !skillsError);
  const loadError =
    view === "apps" || view === "installed"
      ? catalogError
      : view === "skills"
        ? skillsError
        : (catalogError ?? skillsError);

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
              onClick={() => {
                setView(item.id);
                setSelectedKey(null);
              }}
              count={
                loading
                  ? "loading"
                  : item.id === "discover"
                    ? allEntries.length
                    : item.id === "installed"
                      ? appEntries.filter(
                          (entry) =>
                            entry.kind === "app" &&
                            installedIds.has(packageIdentityKey(entry.item)),
                        ).length
                      : item.id === "apps"
                        ? appEntries.length
                        : skillEntries.length
              }
            />
          ))}
        </ModalNav>
        <div className="border-aomi-border mt-2 md:mt-5 md:border-t md:pt-4">
          <span className="type-eyebrow text-aomi-muted hidden px-2.5 md:block">
            Categories
          </span>
          <ModalNav label="Library categories" className="mt-2">
            {CATEGORIES.map((category) => (
              <ModalNavItem
                key={category.id}
                label={category.label}
                icon={category.icon}
                active={view === category.id}
                onClick={() => {
                  setView(category.id);
                  setSelectedKey(null);
                }}
                count={loading ? "loading" : categoryCounts.get(category.id)}
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
          onQueryChange={(next) => {
            setQuery(next);
            setSelectedKey(null);
          }}
          searchRef={searchRef}
        />
        {actionError ? (
          <p
            role="alert"
            className="bg-aomi-surface-2 text-aomi-danger rounded-control type-meta mt-3 px-3 py-2"
          >
            {actionError}
          </p>
        ) : null}
        <SectionHeader
          as="h2"
          title={listTitle}
          count={loading ? undefined : visible.length}
          className="mt-4 px-1"
        />
        <div ref={listRef} className="mt-2 min-h-0 flex-1 overflow-y-auto">
          {loadError ? (
            <div className="type-meta flex min-h-44 flex-col items-center justify-center gap-3 text-center">
              <p className="text-aomi-muted">{loadError}</p>
              <AomiButton
                variant="primary"
                onClick={() => {
                  retryApps();
                  retrySkills();
                }}
              >
                Retry
              </AomiButton>
            </div>
          ) : loading ? (
            <LoadingPane label="Loading library" className="h-full" />
          ) : visible.length === 0 ? (
            <EmptyList />
          ) : (
            <div className="space-y-0.5">
              {visible.map((entry, index) => (
                <div key={selectionKey(entry)}>
                  {!selectionIsOfficial(entry) &&
                  (index === 0 || selectionIsOfficial(visible[index - 1])) ? (
                    <div className="border-aomi-border type-eyebrow text-aomi-muted mt-3 border-t px-2 pt-3">
                      Community apps
                    </div>
                  ) : null}
                  <CatalogRow
                    selection={entry}
                    selected={
                      activeSelection
                        ? selectionKey(activeSelection) === selectionKey(entry)
                        : false
                    }
                    installed={
                      entry.kind === "app" &&
                      installedIds.has(packageIdentityKey(entry.item))
                    }
                    busy={
                      entry.kind === "app" &&
                      busyId === packageIdentityKey(entry.item)
                    }
                    disabled={!installedReady || busyId !== null}
                    hostChainIds={hostChainIds}
                    onSelect={() => {
                      setSelectedKey(selectionKey(entry));
                      setMobileDetailOpen(true);
                    }}
                    onInstall={() =>
                      entry.kind === "app" && entry.item.secrets.length > 0
                        ? (() => {
                            setSelectedKey(selectionKey(entry));
                            setMobileDetailOpen(true);
                          })()
                        : entry.kind === "app" && void install(entry.item)
                    }
                    onTry={() => entry.kind === "skill" && trySkill(entry.item)}
                  />
                </div>
              ))}
            </div>
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
        {actionError && mobileDetailOpen ? (
          <p
            role="alert"
            className="bg-aomi-surface-2 text-aomi-danger rounded-control type-meta mx-4 mt-3 px-3 py-2 md:hidden"
          >
            {actionError}
          </p>
        ) : null}
        <LibraryDetailPanel
          key={`${activeSelection ? selectionKey(activeSelection) : "none"}:${mobileDetailOpen}`}
          selection={loading ? null : activeSelection}
          loading={loading}
          installed={selectedInstalled}
          installedReady={installedReady}
          busy={
            activeSelection?.kind === "app" &&
            busyId === packageIdentityKey(activeSelection.item)
          }
          hostChainIds={hostChainIds}
          accountUserId={accountUserId}
          onInstall={install}
          onUninstall={uninstall}
          onTrySkill={trySkill}
        />
      </div>
    </ModalShell>
  );
}
