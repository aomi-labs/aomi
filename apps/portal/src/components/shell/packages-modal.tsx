"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X as Close, Filter, Loader2, Search } from "lucide-react";
import { ModalBackdrop } from "@/components/ui/modal-backdrop";
import { useAomiWalletKit } from "@aomi-labs/widget-lib";
import {
  seedAccountOverview,
  useAccountOverview,
} from "@portal/lib/account-overview";
import { PackageIcon, PackageRow } from "./package-row";
import {
  CATEGORY_ORDER,
  PERSONAL_CATEGORY_ORDER,
  PINNED_APPS,
  type PackageVisibility,
} from "./packages-catalog";
import { setInstalledApps } from "./packages-api";
import { usePackageCatalog } from "./use-package-catalog";

interface PackagesModalProps {
  onClose: () => void;
}

export function PackagesModal({ onClose }: PackagesModalProps) {
  const activeChainId = useAomiWalletKit().identity.chainId;
  const account = useAccountOverview();
  const { catalog, error: catalogError, retry } = usePackageCatalog();
  const [activeView, setActiveView] = useState<PackageVisibility>("public");
  const [query, setQuery] = useState("");
  const [installedOnly, setInstalledOnly] = useState(false);
  // null until either the PUT response or the account overview seeds it —
  // the PUT response is the fresher truth once any mutation has run.
  const [installedFromServer, setInstalledFromServer] = useState<{
    userId: string;
    apps: string[];
  } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const mutationInFlight = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const accountUserId = account?.user.user_id;
  const installedBaseline =
    installedFromServer && installedFromServer.userId === accountUserId
      ? installedFromServer.apps
      : (account?.user.apps ?? null);
  const installedReady = installedBaseline !== null;
  const installedIds = useMemo(() => {
    const fromAccount = installedBaseline ?? [];
    const ids = new Set(fromAccount);
    for (const pinned of PINNED_APPS) ids.add(pinned);
    return ids;
  }, [installedBaseline]);

  /**
   * Replace the installed set on the server. Not optimistic: the button shows
   * busy and the row flips only on the PUT response, so a rejected write can't
   * leave a phantom install.
   */
  const mutateInstalled = useCallback(
    async (packageId: string, next: string[]) => {
      if (
        !installedReady ||
        !account ||
        !accountUserId ||
        mutationInFlight.current
      ) {
        return;
      }
      mutationInFlight.current = true;
      setBusyId(packageId);
      setActionError(null);
      try {
        const apps = await setInstalledApps(next);
        setInstalledFromServer({ userId: accountUserId, apps });
        seedAccountOverview({
          ...account,
          user: { ...account.user, apps },
        });
      } catch (cause) {
        setActionError(
          cause instanceof Error ? cause.message : "Couldn't update packages",
        );
      } finally {
        mutationInFlight.current = false;
        setBusyId(null);
      }
    },
    [account, accountUserId, installedReady],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      // "/" and ⌘K jump to search — the primary way into a catalog this size.
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

  const searching = query.trim().length > 0;

  const visiblePackages = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const source = (catalog ?? []).filter(
      (app) => app.visibility === activeView,
    );

    return source.filter((app) => {
      if (installedOnly && !installedIds.has(app.id)) return false;
      if (!normalizedQuery) return true;
      return `${app.name} ${app.description}`
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [catalog, activeView, query, installedOnly, installedIds]);

  const installedPackages = (catalog ?? []).filter((app) =>
    installedIds.has(app.id),
  );
  const categories =
    activeView === "public" ? CATEGORY_ORDER : PERSONAL_CATEGORY_ORDER;

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

  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{ zIndex: 60 }}
    >
      <ModalBackdrop aria-label="Dismiss packages" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="packages-title"
        className="border-aomi-border bg-aomi-raised text-aomi-fg relative flex flex-col overflow-hidden rounded-2xl border"
        // Match Settings exactly within the full Portal frame.
        style={{ width: 900, height: 600, maxWidth: "95%", maxHeight: "92%" }}
      >
        <header className="border-aomi-border relative shrink-0 border-b px-[22px] pb-2 pt-[22px]">
          <h1 id="packages-title" className="text-[15px] font-semibold">
            Packages
          </h1>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close packages"
            className="bg-aomi-surface-2 text-aomi-muted hover:bg-aomi-hover hover:text-aomi-fg flex h-8 w-8 items-center justify-center rounded-full transition-colors"
            style={{ position: "absolute", right: 22, top: 18 }}
          >
            <Close size={16} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col px-[22px] pb-5 pt-4">
          <label className="border-aomi-border bg-aomi-surface focus-within:border-aomi-muted flex h-[38px] items-center gap-2.5 rounded-full border px-4 transition-colors">
            <Search size={16} className="text-aomi-muted flex-shrink-0" />
            <span className="sr-only">Search packages</span>
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search packages"
              className="placeholder:text-aomi-muted min-w-0 flex-1 bg-transparent text-[13px] outline-none"
            />
            {searching ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  searchRef.current?.focus();
                }}
                aria-label="Clear search"
                className="text-aomi-muted hover:bg-aomi-hover hover:text-aomi-fg flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full transition-colors"
              >
                <Close size={12} />
              </button>
            ) : (
              <kbd className="border-aomi-border text-aomi-muted flex-shrink-0 rounded border px-1.5 py-0.5 font-mono text-[11px]">
                /
              </kbd>
            )}
          </label>

          {actionError && (
            <p className="border-aomi-border bg-aomi-surface text-aomi-danger mt-4 rounded-xl border px-4 py-3 text-[13px]">
              {actionError}
            </p>
          )}

          <section
            className="border-aomi-border mt-4 border-t pt-4"
            aria-labelledby="installed-packages-title"
          >
            <div className="flex items-center">
              <h2
                id="installed-packages-title"
                className="text-sm font-semibold leading-5"
              >
                Installed
                <span className="text-aomi-muted ml-2 font-mono text-xs font-normal">
                  {installedPackages.length}
                </span>
              </h2>
            </div>
            {installedPackages.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {installedPackages.map((app) => (
                  <button
                    key={app.id}
                    type="button"
                    title={app.description}
                    className="hover:bg-aomi-hover group flex w-[70px] flex-col items-center gap-1.5 rounded-xl px-1 py-2 transition-colors"
                  >
                    <PackageIcon app={app} size="small" />
                    <span className="text-aomi-muted group-hover:text-aomi-fg w-full truncate text-center text-[10px] transition-colors">
                      {app.name}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="border-aomi-border bg-aomi-surface flex rounded-full border p-[3px]">
              {(["public", "personal"] as PackageVisibility[]).map((view) => (
                <button
                  key={view}
                  type="button"
                  onClick={() => setActiveView(view)}
                  aria-pressed={activeView === view}
                  className={`rounded-full px-3.5 py-[5px] text-[13px] transition-colors ${
                    activeView === view
                      ? "bg-aomi-accent-strong text-aomi-on-accent font-medium"
                      : "text-aomi-muted hover:text-aomi-fg"
                  }`}
                >
                  {view === "public" ? "Public" : "Personal"}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setInstalledOnly((v) => !v)}
              aria-pressed={installedOnly}
              className={`flex items-center gap-2 rounded-full border px-3.5 py-[5px] text-[13px] transition-colors ${
                installedOnly
                  ? "bg-aomi-accent-strong text-aomi-on-accent border-transparent font-medium"
                  : "border-aomi-border bg-aomi-surface-2 text-aomi-muted hover:text-aomi-fg"
              }`}
            >
              <Filter size={14} />
              Installed only
            </button>
          </div>

          <div className="border-aomi-border mt-5 min-h-0 flex-1 overflow-y-auto border-t">
            {catalogError ? (
              <div className="flex h-full min-h-40 flex-col items-center justify-center gap-3 px-6 py-8 text-center text-[13px]">
                <p className="text-aomi-muted">{catalogError}</p>
                <button
                  type="button"
                  onClick={retry}
                  className="bg-aomi-fg text-aomi-bg rounded-full px-4 py-2 font-medium transition-opacity hover:opacity-90"
                >
                  Retry
                </button>
              </div>
            ) : catalog === null ? (
              <div className="text-aomi-muted flex h-full min-h-40 items-center justify-center gap-2 px-6 py-8 text-[13px]">
                <Loader2 size={15} className="animate-spin" />
                Loading packages…
              </div>
            ) : visiblePackages.length === 0 ? (
              <div className="flex h-full min-h-40 flex-col items-center justify-center px-6 py-8 text-center text-[13px]">
                <p className="font-medium">No packages found</p>
                <p className="text-aomi-muted mt-1">
                  {installedOnly
                    ? "Nothing installed matches — try turning off “Installed only”."
                    : "Try another name or capability."}
                </p>
                {(searching || installedOnly) && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      setInstalledOnly(false);
                    }}
                    className="border-aomi-border hover:bg-aomi-hover mt-4 rounded-lg border px-3.5 py-2 font-medium transition-colors"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            ) : searching || installedOnly ? (
              // Flat, counted list — category headers fragment a short result set.
              <section aria-label="Search results">
                <h2 className="border-aomi-border flex items-baseline gap-2 border-b pb-3 text-[13px] font-semibold">
                  Results
                  <span className="text-aomi-muted font-mono text-xs font-normal">
                    {visiblePackages.length}
                  </span>
                </h2>
                <div className="grid md:grid-cols-2 md:gap-x-8">
                  {visiblePackages.map((app) => (
                    <PackageRow
                      key={app.id}
                      app={app}
                      installed={installedIds.has(app.id)}
                      busy={busyId === app.id}
                      disabled={!installedReady || busyId !== null}
                      activeChainId={activeChainId}
                      onInstall={() => install(app.id)}
                      onUninstall={() => uninstall(app.id)}
                    />
                  ))}
                </div>
              </section>
            ) : (
              categories.map((category) => {
                const items = visiblePackages.filter(
                  (app) => app.category === category,
                );
                if (items.length === 0) return null;
                const categoryId = `packages-${category.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`;

                return (
                  <section
                    key={category}
                    className="mb-6"
                    aria-labelledby={categoryId}
                  >
                    <h2
                      id={categoryId}
                      className="border-aomi-border flex items-baseline gap-2 border-b pb-3 text-[13px] font-semibold"
                    >
                      {category}
                      <span className="text-aomi-muted font-mono text-xs font-normal">
                        {items.length}
                      </span>
                    </h2>
                    <div className="grid md:grid-cols-2 md:gap-x-8">
                      {items.map((app) => (
                        <PackageRow
                          key={app.id}
                          app={app}
                          installed={installedIds.has(app.id)}
                          busy={busyId === app.id}
                          disabled={!installedReady || busyId !== null}
                          activeChainId={activeChainId}
                          onInstall={() => install(app.id)}
                          onUninstall={() => uninstall(app.id)}
                        />
                      ))}
                    </div>
                  </section>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
