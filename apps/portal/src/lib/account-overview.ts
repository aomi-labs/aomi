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
import { settingsApiFetch } from "@portal/lib/settings-api";

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

let current: AccountOverview | null = null;
let inflight: Promise<void> | null = null;
let revision = 0;
let scopedUserId: string | undefined;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

/** Seed (or clear, with null) the shared overview — the session probe's job. */
export function seedAccountOverview(data: AccountOverview | null) {
  if (data && scopedUserId && data.user.user_id !== scopedUserId) return;
  scopedUserId = data?.user.user_id;
  revision += 1;
  current = data;
  inflight = null;
  emit();
}

/** Drop a snapshot that belongs to a different authenticated account. */
export function scopeAccountOverviewToUser(userId: string) {
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
  const request = settingsApiFetch<AccountOverview>("/api/account")
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
const getSnapshot = () => current;
const getServerSnapshot = () => null;

export function useAccountOverview(): AccountOverview | null {
  const data = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    if (!data) void loadOnce();
  }, [data]);
  return data;
}

/** Shared allowance line — matches mock sidebar/menu and Usage tab copy. */
export function formatAllowanceSummary(used: number, included: number): string {
  const remaining = Math.max(0, included - used);
  return `${remaining.toLocaleString()} left · ${used.toLocaleString()}/${included.toLocaleString()} used`;
}
