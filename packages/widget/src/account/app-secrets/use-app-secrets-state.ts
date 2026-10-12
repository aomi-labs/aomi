"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchDisplayQuery,
  useAomiDisplayCache,
  type DisplayCache,
} from "@aomi-labs/react";
import type {
  AomiSecretSlot,
  AomiUserAppSecretSlot,
  AomiUserAppSecrets,
  ApplicationId,
} from "@aomi-labs/client";

export type AppSecretOperations = {
  list: (
    applicationId: Exclude<ApplicationId, null>,
  ) => Promise<AomiUserAppSecrets>;
  save: (
    applicationId: Exclude<ApplicationId, null>,
    secrets: Record<string, string>,
  ) => Promise<AomiUserAppSecrets>;
  remove: (
    applicationId: Exclude<ApplicationId, null>,
    name: string,
  ) => Promise<unknown>;
};

type UseAppSecretsStateOptions = {
  scopeKey: string;
  applicationId: ApplicationId | null | undefined;
  enabled: boolean;
  declaredSlots: readonly AomiSecretSlot[];
  operations: AppSecretOperations;
};

/** Secret status lives in the display cache under the signed-in account. */
function secretsQuery(
  cache: DisplayCache | null,
  applicationId: Exclude<ApplicationId, null>,
  list: () => Promise<AomiUserAppSecrets>,
) {
  if (cache?.scope.account?.kind !== "user") return null;
  const query = {
    resource: "account-apps" as const,
    parameters: ["secrets", String(applicationId)],
    fetcher: list,
  };
  const key = cache.key(query.resource, query.parameters);
  return {
    peek: () => cache.client.getQueryData<AomiUserAppSecrets>(key),
    fetch: () => fetchDisplayQuery(cache, query),
    // An older read still in flight must not land on top of this write.
    write: (next: AomiUserAppSecrets) => {
      void cache.client.cancelQueries({ queryKey: key, exact: true });
      cache.client.setQueryData(key, next);
    },
  };
}

export function appSecretsReady(status: AomiUserAppSecrets): boolean {
  return (
    status.ready ??
    status.slots.every((slot) => !slot.required || slot.configured)
  );
}

/**
 * One scoped owner for the credential lifecycle shared by Library and the
 * composer: status loading, stale-response rejection, drafts, mutations, and
 * refresh. Layout-specific open/close and value-visibility state stays with
 * the rendering component.
 */
export function useAppSecretsState({
  scopeKey,
  applicationId,
  enabled,
  declaredSlots,
  operations,
}: UseAppSecretsStateOptions) {
  const operationsRef = useRef(operations);
  operationsRef.current = operations;
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  // Reopening the same scope must not revive work from an earlier visit.
  const lifetimeRef = useRef(0);
  const requestRevisionRef = useRef(0);
  const [status, setStatus] = useState<AomiUserAppSecrets | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A ref, so the cache's identity changing never resets drafts.
  const displayCache = useAomiDisplayCache();
  const cacheRef = useRef(displayCache);
  cacheRef.current = displayCache;
  const cached = useCallback(
    () =>
      applicationId == null
        ? null
        : secretsQuery(cacheRef.current, applicationId, () =>
            operationsRef.current.list(applicationId),
          ),
    [applicationId],
  );

  /** `fresh` skips the shared cache; opening a scope reuses it. */
  const load = useCallback(
    async (fresh: boolean): Promise<AomiUserAppSecrets | null> => {
      if (!enabled || applicationId == null) return null;
      const requestScope = scopeKey;
      const lifetime = lifetimeRef.current;
      const revision = ++requestRevisionRef.current;
      const cache = cached();
      try {
        const next =
          cache && !fresh
            ? await cache.fetch()
            : await operationsRef.current.list(applicationId);
        if (
          scopeRef.current === requestScope &&
          lifetimeRef.current === lifetime &&
          requestRevisionRef.current === revision
        ) {
          // Only the newest read may replace what a later save cached.
          if (fresh) cache?.write(next);
          setStatus(next);
          setError(null);
        }
        return next;
      } catch (cause) {
        if (
          scopeRef.current === requestScope &&
          lifetimeRef.current === lifetime &&
          requestRevisionRef.current === revision
        ) {
          setStatus(null);
          setError(
            cause instanceof Error
              ? cause.message
              : "Couldn’t load saved credentials.",
          );
        }
        return null;
      }
    },
    [applicationId, cached, enabled, scopeKey],
  );
  const refresh = useCallback(() => load(true), [load]);

  useEffect(() => {
    requestRevisionRef.current += 1;
    setDrafts({});
    setError(null);
    setBusyName(null);
    if (!enabled || applicationId == null) {
      setStatus(null);
      setLoading(false);
      return;
    }
    // A status this account already read shows at once; the cache decides
    // whether it is fresh enough to skip the network.
    const known = cached()?.peek() ?? null;
    setStatus(known);
    let current = true;
    setLoading(known === null);
    void load(false).finally(() => {
      if (current && scopeRef.current === scopeKey) setLoading(false);
    });
    return () => {
      current = false;
      lifetimeRef.current += 1;
      requestRevisionRef.current += 1;
    };
  }, [applicationId, cached, enabled, load, scopeKey]);

  const slots = useMemo<AomiUserAppSecretSlot[]>(
    () =>
      status?.slots.filter((slot) => slot.user_own !== false) ??
      declaredSlots.map((slot) => ({
        ...slot,
        user_own: slot.user_own === true,
        configured: false,
        app_provided: false,
      })),
    [declaredSlots, status],
  );
  const pending = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(drafts)
          .map(([name, value]) => [name, value.trim()])
          .filter((entry) => entry[1].length > 0),
      ),
    [drafts],
  );

  const save = useCallback(async (): Promise<AomiUserAppSecrets | null> => {
    if (applicationId == null || Object.keys(pending).length === 0)
      return status;
    const requestScope = scopeKey;
    const lifetime = lifetimeRef.current;
    const isCurrent = () =>
      scopeRef.current === requestScope && lifetimeRef.current === lifetime;
    // Reads started before or during this mutation must not replace its result.
    requestRevisionRef.current += 1;
    setBusyName("save");
    setError(null);
    try {
      const next = await operationsRef.current.save(applicationId, pending);
      cached()?.write(next);
      if (!isCurrent()) return null;
      requestRevisionRef.current += 1;
      setStatus(next);
      setDrafts({});
      return next;
    } catch (cause) {
      if (isCurrent()) {
        setError(
          cause instanceof Error ? cause.message : "Couldn’t save credentials.",
        );
      }
      return null;
    } finally {
      if (isCurrent()) setBusyName(null);
    }
  }, [applicationId, cached, pending, scopeKey, status]);

  const remove = useCallback(
    async (name: string): Promise<boolean> => {
      if (applicationId == null) return false;
      const requestScope = scopeKey;
      const lifetime = lifetimeRef.current;
      const isCurrent = () =>
        scopeRef.current === requestScope && lifetimeRef.current === lifetime;
      const requestOperations = operationsRef.current;
      requestRevisionRef.current += 1;
      setBusyName(name);
      setError(null);
      try {
        await requestOperations.remove(applicationId, name);
        if (!isCurrent()) return false;
        const next = await requestOperations.list(applicationId);
        cached()?.write(next);
        if (!isCurrent()) return false;
        requestRevisionRef.current += 1;
        setStatus(next);
        return true;
      } catch (cause) {
        if (isCurrent()) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Couldn’t remove the saved credential.",
          );
        }
        return false;
      } finally {
        if (isCurrent()) setBusyName(null);
      }
    },
    [applicationId, cached, scopeKey],
  );

  const retry = useCallback(async () => {
    const lifetime = lifetimeRef.current;
    setLoading(true);
    await refresh();
    if (scopeRef.current === scopeKey && lifetimeRef.current === lifetime)
      setLoading(false);
  }, [refresh, scopeKey]);

  return {
    status,
    slots,
    drafts,
    setDraft: (name: string, value: string) =>
      setDrafts((current) => ({ ...current, [name]: value })),
    clearDrafts: () => setDrafts({}),
    pending,
    hasPending: Object.keys(pending).length > 0,
    loading,
    busyName,
    busy: busyName !== null,
    error,
    setError,
    refresh,
    retry,
    save,
    remove,
  };
}
