"use client";

/**
 * One shared /api/account overview for the settings surfaces.
 *
 * The session probe (aomi-session-bridge) seeds this store when its probe
 * succeeds, so opening Settings normally costs zero extra account fetches.
 * A consumer that mounts with an empty store (tests, direct embeds) triggers
 * a single deduplicated fetch instead of each component fetching on its own.
 */

import { useEffect, useSyncExternalStore } from "react";
import { MICROUSD_PER_CREDIT } from "@aomi-labs/client";
import { settingsApiFetch } from "./settings-api";
import { useShellTransport, type ShellRequest } from "../transport";

export type AccountProfile = {
  user_id: string;
  public_key?: string;
  verified_email?: string | null;
  tier?: string;
  created_at?: number;
  /** The account's installed apps (`users.applications`). */
  apps?: string[];
};

export type AccountOverview = {
  user: AccountProfile;
};

export type CreditAllowance = {
  used: number;
  included: number;
};

/** Treat account-credit responses as untrusted across rolling deployments. */
export function creditAllowanceFromPosition(
  position: unknown,
): CreditAllowance | null {
  if (!position || typeof position !== "object") return null;
  const record = position as Record<string, unknown>;
  const included = record.included;
  const legacy =
    included && typeof included === "object"
      ? (included as Record<string, unknown>)
      : undefined;
  const used = record.included_used ?? legacy?.used_microusd;
  const limit = record.included_limit ?? legacy?.limit_microusd;
  if (
    typeof used !== "number" ||
    !Number.isFinite(used) ||
    typeof limit !== "number" ||
    !Number.isFinite(limit)
  ) {
    return null;
  }
  return {
    used: used / MICROUSD_PER_CREDIT,
    included: limit / MICROUSD_PER_CREDIT,
  };
}

function createOverviewStore(fetchOverview: ShellRequest) {
  let current: AccountOverview | null = null;
  let inflight: Promise<void> | null = null;
  let revision = 0;
  let scopedUserId: string | undefined;
  const listeners = new Set<() => void>();

  const emit = () => {
    for (const listener of listeners) listener();
  };

  /** Seed (or clear, with null) the shared overview — the session probe's job. */
  function seedAccountOverview(data: AccountOverview | null) {
    if (data && scopedUserId && data.user.user_id !== scopedUserId) return;
    scopedUserId = data?.user.user_id;
    revision += 1;
    current = data;
    inflight = null;
    emit();
  }

  /** Apply an installed-app response only to the account that requested it. */
  function updateAccountApps(userId: string, apps: string[]): void {
    if (current?.user.user_id !== userId) return;
    seedAccountOverview({ ...current, user: { ...current.user, apps } });
  }

  /** Drop a snapshot that belongs to a different authenticated account. */
  function scopeAccountOverviewToUser(userId: string) {
    if (scopedUserId !== userId && inflight) {
      revision += 1;
      inflight = null;
    }
    scopedUserId = userId;
    if (current && current.user.user_id !== userId) {
      revision += 1;
      current = null;
      emit();
    }
  }

  function loadOnce(): Promise<void> {
    if (current) return Promise.resolve();
    if (inflight) return inflight;

    const requestRevision = revision;
    const request = fetchOverview<AccountOverview>("/api/account")
      .then((data) => {
        // An auth transition may have cleared or replaced the store while this
        // request was in flight. Never let the old account repopulate it.
        if (revision !== requestRevision) return;
        if (scopedUserId && data.user.user_id !== scopedUserId) return;
        scopedUserId = data.user.user_id;
        current = data;
        emit();
      })
      .catch(() => {
        // Leave the store empty — consumers fall back to wallet-kit identity.
      })
      .finally(() => {
        if (inflight === request) inflight = null;
      });
    inflight = request;
    return request;
  }

  const subscribe = (callback: () => void) => {
    listeners.add(callback);
    return () => {
      listeners.delete(callback);
    };
  };

  return {
    seedAccountOverview,
    updateAccountApps,
    scopeAccountOverviewToUser,
    subscribe,
    snapshot: () => current,
    loadOnce,
  };
}
const defaultStore = createOverviewStore(settingsApiFetch);
const stores = new WeakMap<
  ShellRequest,
  ReturnType<typeof createOverviewStore>
>();
export const {
  seedAccountOverview,
  updateAccountApps,
  scopeAccountOverviewToUser,
} = defaultStore;
export function useAccountOverviewStore() {
  const transport = useShellTransport();
  if (!transport.embedded) return defaultStore;
  let store = stores.get(transport.json);
  if (!store) {
    store = createOverviewStore(transport.json);
    stores.set(transport.json, store);
  }
  return store;
}
export function useAccountOverview(): AccountOverview | null {
  const store = useAccountOverviewStore();
  const data = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    () => null,
  );
  useEffect(() => {
    if (!data) void store.loadOnce();
  }, [data, store]);
  return data;
}
/** Shared allowance line — matches mock sidebar/menu and Usage tab copy. */
export function formatAllowanceSummary(used: number, included: number): string {
  const remaining = Math.max(0, included - used);
  return `${remaining.toLocaleString()} left · ${used.toLocaleString()}/${included.toLocaleString()} used`;
}
