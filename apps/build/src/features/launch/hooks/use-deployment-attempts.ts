"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { attemptRequest, type ProjectDeploymentAttempt } from "../attempts";
import { LaunchRequestError } from "@aomi-labs/deploy/launch";

export type LocalAttempt = {
  id: string;
  createdAt: string;
  branch: string;
  message: string;
  pending: boolean;
};
type Page = { attempts: ProjectDeploymentAttempt[]; nextPage?: number | null };
function savedAttempts(storageKey: string): LocalAttempt[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    if (!Array.isArray(saved)) return [];
    return saved
      .filter(
        (item) =>
          item &&
          typeof item.id === "string" &&
          typeof item.message === "string" &&
          typeof item.branch === "string" &&
          typeof item.createdAt === "string",
      )
      .slice(0, 10)
      .map((item) => ({
        ...item,
        pending: false,
        message: item.pending
          ? "Start acknowledgement was interrupted. Reconnect to check GitHub before retrying."
          : item.message,
      }));
  } catch {
    return [];
  }
}

export function useDeploymentAttempts(
  projectId: number,
  accountKey: string | null,
) {
  const client = useQueryClient();
  const key = useMemo(
    () => ["deployment-attempts", accountKey, projectId] as const,
    [accountKey, projectId],
  );
  const localKey = useMemo(() => [...key, "local"] as const, [key]);
  const storageKey = `aomi-build:attempts:${accountKey}:${projectId}`;
  // Query-cache ownership survives navigation while a POST is awaiting its
  // acknowledgement. Storage is only the fallback after a full page reload.
  const localQuery = useQuery({
    queryKey: localKey,
    queryFn: async () => [] as LocalAttempt[],
    initialData: [] as LocalAttempt[],
    enabled: false,
    gcTime: Infinity,
  });
  useEffect(() => {
    if (!client.getQueryData<LocalAttempt[]>(localKey)?.length) {
      const saved = savedAttempts(storageKey);
      if (saved.length) client.setQueryData(localKey, saved);
    }
  }, [client, localKey, storageKey]);
  const local = localQuery.data;
  const persist = useCallback(
    (items: LocalAttempt[]) => {
      client.setQueryData(localKey, items);
      try {
        localStorage.setItem(storageKey, JSON.stringify(items.slice(0, 10)));
      } catch {
        /* Visible state still works without storage. */
      }
    },
    [client, localKey, storageKey],
  );
  const query = useInfiniteQuery({
    queryKey: key,
    enabled: !!accountKey,
    initialPageParam: 1,
    queryFn: async ({ signal, pageParam }) => {
      const response = await attemptRequest<Page>(projectId, {
        signal,
        page: pageParam,
      });
      const cached =
        client
          .getQueryData<InfiniteData<Page>>(key)
          ?.pages.flatMap((page) => page.attempts) ?? [];
      const attempts: ProjectDeploymentAttempt[] = [];
      // Only the latest cards and the newest active run need detail polling.
      // Older cards load on expansion, keeping history reads bounded for
      // large accounts.
      const visible = [...response.attempts];
      if (pageParam === 1)
        for (const item of cached) {
          if (
            item.status !== "completed" &&
            !visible.some((attempt) => attempt.id === item.id)
          )
            visible.unshift(item);
        }
      const newestActive = visible.find(
        (attempt) => attempt.status !== "completed",
      )?.id;
      for (const [index, attempt] of visible.entries()) {
        const known = cached.find((item) => item.id === attempt.id);
        if (
          attempt.status === "completed" &&
          known?.status === "completed" &&
          known.jobs?.length
        )
          attempts.push(known);
        else if ((pageParam === 1 && index < 2) || attempt.id === newestActive)
          attempts.push(
            (
              await attemptRequest<{ attempt: ProjectDeploymentAttempt }>(
                projectId,
                { runId: attempt.id, signal },
              )
            ).attempt,
          );
        else attempts.push(attempt);
      }
      return { ...response, attempts };
    },
    getNextPageParam: (page) => page.nextPage ?? undefined,
    retry: (count, error) =>
      count < 4 &&
      !(
        error instanceof LaunchRequestError &&
        [401, 403, 404].includes(error.status)
      ),
    retryDelay: (count) => Math.min(4000 * 2 ** count, 30000),
    refetchInterval: (query) =>
      query.state.error
        ? false
        : query.state.data?.pages[0]?.attempts.some(
              (item) => item.status !== "completed",
            )
          ? 10000
          : 30000,
    refetchOnWindowFocus: false,
  });
  const attempts = useMemo(() => {
    const unique = new Map<number, ProjectDeploymentAttempt>();
    for (const attempt of query.data?.pages.flatMap((page) => page.attempts) ??
      []) {
      if (!unique.has(attempt.id)) unique.set(attempt.id, attempt);
    }
    return Array.from(unique.values());
  }, [query.data]);

  const [mutation, setMutation] = useState<{
    scope: string;
    error?: string;
    notice?: string;
    cancelling?: number;
  }>({ scope: storageKey });
  const mutationError =
    mutation.scope === storageKey ? (mutation.error ?? null) : null;
  const mutationNotice =
    mutation.scope === storageKey ? (mutation.notice ?? null) : null;
  const cancelling =
    mutation.scope === storageKey ? (mutation.cancelling ?? null) : null;
  const updateAttempt = useCallback(
    (attempt: ProjectDeploymentAttempt) => {
      client.setQueryData<InfiniteData<Page>>(key, (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((page) => ({
                ...page,
                attempts: page.attempts.map((item) =>
                  item.id === attempt.id ? attempt : item,
                ),
              })),
            }
          : data,
      );
    },
    [client, key],
  );
  const loadDetail = useCallback(
    async (runId: number) => {
      try {
        updateAttempt(
          (
            await attemptRequest<{ attempt: ProjectDeploymentAttempt }>(
              projectId,
              { runId },
            )
          ).attempt,
        );
      } catch (error) {
        setMutation({
          scope: storageKey,
          error:
            error instanceof Error
              ? error.message
              : "Could not load attempt details",
        });
      }
    },
    [projectId, storageKey, updateAttempt],
  );
  const start = useCallback(
    async (branch = "") => {
      const previous = client.getQueryData<LocalAttempt[]>(localKey) ?? [];
      if (previous.some((item) => item.pending)) return;
      const current: LocalAttempt = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        branch,
        message: "Validating latest commit…",
        pending: true,
      };
      const next = [current, ...previous].slice(0, 10);
      persist(next);
      setMutation({ scope: storageKey });
      try {
        const result = await attemptRequest<{
          attempt: ProjectDeploymentAttempt;
          existing: boolean;
        }>(projectId, { action: "start", branch });
        persist(next.filter((item) => item.id !== current.id));
        if (result.existing)
          setMutation({
            scope: storageKey,
            notice: "A deployment is already running; showing it",
          });
        // Keyed by id, so an existing run is surfaced, never duplicated.
        client.setQueryData<InfiniteData<Page>>(key, (data) => ({
          pageParams: data?.pageParams ?? [1],
          pages: [
            {
              ...data?.pages[0],
              attempts: [
                result.attempt,
                ...(data?.pages[0]?.attempts ?? []).filter(
                  (item) => item.id !== result.attempt.id,
                ),
              ],
            },
            ...(data?.pages.slice(1) ?? []),
          ],
        }));
        void client.invalidateQueries({ queryKey: key, exact: true });
        return result.attempt;
      } catch (error) {
        persist(
          next.map((item) =>
            item.id === current.id
              ? {
                  ...item,
                  pending: false,
                  message:
                    error instanceof Error
                      ? error.message
                      : "Could not start deployment",
                }
              : item,
          ),
        );
        return undefined;
      }
    },
    [projectId, storageKey, localKey, key, persist, client],
  );
  const cancel = useCallback(
    async (runId: number) => {
      setMutation({ scope: storageKey, cancelling: runId });
      try {
        await attemptRequest(projectId, { action: "cancel", runId });
        await client.invalidateQueries({ queryKey: key, exact: true });
      } catch (error) {
        setMutation({
          scope: storageKey,
          error:
            error instanceof Error
              ? error.message
              : "Could not cancel deployment",
        });
      }
    },
    [projectId, storageKey, key, client],
  );
  useEffect(() => {
    if (
      cancelling &&
      attempts.find((item) => item.id === cancelling)?.status === "completed"
    )
      setMutation({ scope: storageKey });
  }, [cancelling, attempts, storageKey]);
  return {
    ...query,
    attempts,
    local,
    start,
    cancel,
    cancelling,
    mutationError,
    mutationNotice,
    loadDetail,
    busy:
      local.some((item) => item.pending) ||
      attempts.some((item) => item.status !== "completed"),
    clearLocal: (id: string) => persist(local.filter((item) => item.id !== id)),
  };
}
