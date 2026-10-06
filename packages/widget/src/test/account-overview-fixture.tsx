"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import {
  DisplayCacheProvider,
  displayKey,
  useAomiDisplayCache,
  type DisplayCache,
  type RuntimeAccount,
} from "../../../react/src/query/display-cache";
import type { AccountOverview } from "@/account/account-overview";

/**
 * Test fixture: a display cache whose signed-in user follows the profile a
 * test seeds, as the session probe does in a real frame.
 */
let account: RuntimeAccount | null = null;
let pending: AccountOverview | null = null;
let cache: DisplayCache | null = null;
const listeners = new Set<() => void>();

export function seedAccountOverview(profile: AccountOverview | null) {
  const next: RuntimeAccount | null = profile
    ? { kind: "user", id: profile.user.user_id }
    : null;
  pending = profile;
  if (cache && profile)
    cache.client.setQueryData(
      displayKey({ ...cache.scope, account: next }, "profile"),
      profile,
    );
  if (account?.id !== next?.id) {
    account = next;
    listeners.forEach((listener) => listener());
  }
}

function Capture() {
  const current = useAomiDisplayCache()!;
  if (cache !== current) {
    cache = current;
    if (pending) current.client.setQueryData(current.key("profile"), pending);
  }
  return null;
}

export function AccountOverviewFixture({ children }: { children: ReactNode }) {
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => account,
  );
  return (
    <DisplayCacheProvider backendUrl="" account={current} persistence="none">
      <Capture />
      {children}
    </DisplayCacheProvider>
  );
}
