"use client";

import { useRouter } from "next/navigation";
import { useDeploymentAttempts } from "./use-deployment-attempts";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  UserProject,
  UserProjectLatestDeployment,
} from "@aomi-labs/deploy";
import {
  deploymentProjects,
  launchAppsStatus,
  deploymentHistory,
  deploymentSecrets,
  deploymentSetSecrets,
  deploymentDeleteSecret,
  deploymentRequiredSecrets,
  deploymentSdkStatus,
  deploymentPromote,
  deploymentRecords,
  deploymentDeactivate,
  deploymentUpgradeSdk,
  deploymentSdkUpgradeStatus,
} from "@build/features/launch/client";
import {
  MissingRequiredSecretsError,
  missingRequiredSecrets,
  type RequiredSecretsByApp,
} from "@build/features/launch/required-secrets";
import type {
  DeploymentPromoteResult,
  DeploymentRecord,
  DeploymentProjectsResult,
} from "@build/features/launch/contracts";
import { isRetryableLaunchError } from "@aomi-labs/deploy/launch";
import { useGitHubSession } from "@build/components/control-plane/github-session-context";
import {
  buildQueryKeys,
  buildQueryStaleTime,
  githubAccountKey,
} from "../query-keys";

/** Progress of an in-flight linked-source redeploy (deploy → CI → activate). */
export type DeployFlowState =
  | { phase: "idle" }
  | { phase: "deploying"; message: string }
  | { phase: "building"; message: string }
  | { phase: "activating"; message: string }
  | { phase: "done"; message: string }
  | { phase: "error"; message: string };

type MissingSecrets = Record<string, string[]>;

function mergedRequiredSecrets(
  declared: RequiredSecretsByApp | null,
  gateMissing: MissingSecrets,
  apps: UserProject["apps"] | undefined,
  configured: Record<string, string[]> | null,
): RequiredSecretsByApp | null {
  if (declared === null && Object.keys(gateMissing).length === 0) return null;

  const result: RequiredSecretsByApp = { ...(declared ?? {}) };
  const appsByName = new Map((apps ?? []).map((app) => [app.name, app]));
  for (const [app, names] of Object.entries(gateMissing)) {
    const application = appsByName.get(app);
    const existing = result[app];
    // Preflight refreshes the source before a deploy can reach the 409. Keep
    // this guard nonetheless: inventing an application id would turn a clear
    // retry/reload problem into a write against the wrong app.
    if (!existing && !application) continue;
    const configuredKeys =
      configured?.[app]?.map((handle) => handle.split("::").pop() ?? handle) ??
      null;
    const missing = names.filter(
      (name) => configuredKeys === null || !configuredKeys.includes(name),
    );
    const slots = [...(existing?.slots ?? [])];
    for (const name of names) {
      if (!slots.some((slot) => slot.name === name)) {
        slots.push({
          name,
          description: "Required by the deployment that was blocked.",
          required: true,
        });
      }
    }
    result[app] = {
      applicationId: existing?.applicationId ?? application!.id,
      slots,
      missing: [...new Set([...(existing?.missing ?? []), ...missing])],
    };
  }
  return result;
}

function gateSecretsStorageKey(projectId: number) {
  return `aomi-build:project:${projectId}:candidate-required-secrets`;
}

function persistGateMissingSecrets(projectId: number, missing: MissingSecrets) {
  if (typeof window === "undefined") return;
  const key = gateSecretsStorageKey(projectId);
  if (Object.keys(missing).length === 0) {
    window.sessionStorage.removeItem(key);
  } else {
    window.sessionStorage.setItem(key, JSON.stringify(missing));
  }
}

function storedMissingSecrets(projectId: number): MissingSecrets {
  if (typeof window === "undefined") return {};
  try {
    const parsed: unknown = JSON.parse(
      window.sessionStorage.getItem(gateSecretsStorageKey(projectId)) ?? "{}",
    );
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([app, keys]) =>
        Array.isArray(keys) && keys.every((key) => typeof key === "string")
          ? [[app, keys] as const]
          : [],
      ),
    );
  } catch {
    return {};
  }
}

export function useProjectDetail(projectId: number) {
  const { account } = useGitHubSession();
  const accountKey = githubAccountKey(account.githubLogin);
  const attempts = useDeploymentAttempts(projectId, accountKey);
  const startAttempt = attempts.start;
  const router = useRouter();
  const queryClient = useQueryClient();
  const sourceKey = useMemo(
    () => buildQueryKeys.projectSource(accountKey ?? "unavailable", projectId),
    [accountKey, projectId],
  );
  const projectsKey = buildQueryKeys.projects(accountKey ?? "unavailable");

  // Source + SDK status live in react-query. The source is a server-filtered
  // single-source read (`projectId` on the projects BFF route) — a project
  // page never transfers the whole account. Warm navigations skip even that:
  // `initialData` seeds from the `/projects` list the index already fetched,
  // stamped with that list's own freshness, so list → project paints from
  // cache and doesn't refetch while the list is still fresh.
  // `enabled: !account.loading` fires the read once the session is known
  // (signed-out surfaces the auth error, as the hand-rolled version did),
  // never gating on the SDK badge.
  const projectsQuery = useQuery({
    queryKey: sourceKey,
    queryFn: () => deploymentProjects(undefined, projectId),
    enabled: !account.loading,
    staleTime: buildQueryStaleTime.projects,
    initialData: () => {
      const list =
        queryClient.getQueryData<DeploymentProjectsResult>(projectsKey);
      const seeded = list?.projects.find((s) => s.id === projectId);
      return seeded ? { ...list, projects: [seeded] } : undefined;
    },
    initialDataUpdatedAt: () =>
      queryClient.getQueryState(projectsKey)?.dataUpdatedAt,
  });
  const sdkQuery = useQuery({
    queryKey: buildQueryKeys.sdkStatus(),
    queryFn: () => deploymentSdkStatus().catch(() => null),
    enabled: !account.loading,
    staleTime: buildQueryStaleTime.sdkStatus,
  });
  const rawSource = useMemo(
    () => projectsQuery.data?.projects.find((s) => s.id === projectId) ?? null,
    [projectsQuery.data, projectId],
  );
  const runtimeKey = useMemo(
    () => ["project-runtime", accountKey, projectId] as const,
    [accountKey, projectId],
  );
  const runtime = useQuery({
    queryKey: runtimeKey,
    queryFn: () => launchAppsStatus({ projectId }),
    enabled: !!accountKey && !!rawSource?.apps.some((app) => app.isActive),
    retry: (count, error) => count < 4 && isRetryableLaunchError(error),
    retryDelay: (count) => Math.min(4000 * 2 ** count, 30000),
    // Keep polling through errors: react-query keeps the last data, and the
    // next tick recovers once the runtime answers again.
    refetchInterval: 10000,
    refetchOnWindowFocus: false,
  });
  const source = useMemo(
    () =>
      rawSource
        ? {
            ...rawSource,
            apps: rawSource.apps.map((app) => ({
              ...app,
              // Only a runtime probe proves readiness. Keep its last result
              // through refetch errors; before the first result it is unknown.
              loaded: runtime.data
                ? runtime.data.apps.some(
                    (current) =>
                      current.id === app.id &&
                      current.app_release_tag === app.appReleaseTag &&
                      current.loaded,
                  )
                : undefined,
            })),
          }
        : null,
    [rawSource, runtime.data],
  );
  const sdk = sdkQuery.data ?? null;
  const loading = account.loading || projectsQuery.isPending;
  const error = projectsQuery.error
    ? projectsQuery.error instanceof Error
      ? projectsQuery.error.message
      : "Failed to load project"
    : null;

  const [history, setHistory] = useState<UserProjectLatestDeployment[] | null>(
    null,
  );
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [secretsByApp, setSecrets] = useState<Record<string, string[]> | null>(
    null,
  );
  const [secretsError, setSecretsError] = useState<string | null>(null);
  const [recordsByApp, setRecords] = useState<Record<
    string,
    DeploymentRecord[]
  > | null>(null);
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const [declaredRequiredSecrets, setDeclaredRequiredSecrets] =
    useState<RequiredSecretsByApp | null>(null);
  const [gateMissingSecrets, setGateMissingSecrets] = useState<MissingSecrets>(
    {},
  );
  // Whether the failure above is worth retrying. A missing deploy-time
  // GITHUB_TOKEN is not: no amount of clicking Retry will conjure one, and
  // offering the button implies otherwise.
  const [requiredSecretsRetryable, setRequiredSecretsRetryable] =
    useState(true);
  const [requiredSecretsError, setRequiredSecretsError] = useState<
    string | null
  >(null);
  const latestAttempt = attempts.attempts[0];
  const deployFlow: DeployFlowState = latestAttempt
    ? latestAttempt.status !== "completed"
      ? { phase: "building", message: "Deployment is running in CI" }
      : latestAttempt.conclusion !== "success"
        ? {
            phase: "error",
            message: "Deployment failed. Review the attempt below.",
          }
        : latestAttempt.jobs?.filter((job) =>
              job.name.startsWith("Verify runtime"),
            ).length &&
            latestAttempt.jobs
              .filter((job) => job.name.startsWith("Verify runtime"))
              .every((job) => job.conclusion === "success")
          ? { phase: "done", message: "Runtime verified" }
          : { phase: "idle" }
    : { phase: "idle" };
  const deployStartedAt = latestAttempt
    ? Date.parse(latestAttempt.createdAt)
    : null;
  const historyReq = useRef(false);
  const secretsReq = useRef<Set<number>>(new Set());
  const recordsReq = useRef(false);
  const requiredSecretsReq = useRef(false);
  const gateMissingSecretsRef = useRef<MissingSecrets>({});
  // `id:status` of the latest attempt last seen by the completion effect.
  const seenAttemptRef = useRef<string>(undefined);
  const projectEpochRef = useRef(0);
  // Advance the generation after a project navigation commits. Async reads
  // capture the generation they started in and cannot write into a later page.
  useEffect(() => {
    projectEpochRef.current += 1;
  }, [projectId]);

  // Refetch source + SDK status. Kept stable (keyed via the query client, not
  // the query objects) so callbacks depending on it don't churn every render.
  const reload = useCallback(async () => {
    const requestEpoch = projectEpochRef.current;
    // Clear the records latch so "Refresh" actually recovers a failed
    // deployment-activity load. On error `fetchRecords` sets `recordsByApp` to
    // `{}` (non-null), which otherwise makes `loadRecords` no-op forever and
    // strands the tab on its error banner until a full page reload.
    recordsReq.current = false;
    setRecords(null);
    setRecordsError(null);
    historyReq.current = false;
    setHistory(null);
    setHistoryError(null);
    await Promise.all([
      queryClient.refetchQueries({ queryKey: sourceKey }),
      queryClient.refetchQueries({ queryKey: buildQueryKeys.sdkStatus() }),
    ]);
    if (projectEpochRef.current !== requestEpoch) return;
  }, [queryClient, sourceKey]);

  // Reset deployment-activity latches when the project changes so a same-route
  // navigation (…/projects/1 → …/projects/2, no unmount) cannot show the
  // previous project's records or history. The source refreshes via react-query.
  useEffect(() => {
    recordsReq.current = false;
    setRecords(null);
    setRecordsError(null);
    historyReq.current = false;
    setHistory(null);
    setHistoryError(null);
    secretsReq.current.clear();
    setSecrets(null);
    setSecretsError(null);
    requiredSecretsReq.current = false;
    setDeclaredRequiredSecrets(null);
    setGateMissingSecrets({});
    gateMissingSecretsRef.current = {};
    setRequiredSecretsError(null);
    seenAttemptRef.current = undefined;
  }, [projectId]);

  // A 409 describes a candidate release which the Manager cannot expose until
  // it is activated. Keep its key names (never values) for this browser tab so
  // a refresh or a hop through Settings still lands on an actionable project.
  useEffect(() => {
    const stored = storedMissingSecrets(projectId);
    gateMissingSecretsRef.current = stored;
    setGateMissingSecrets(stored);
  }, [projectId]);

  const requiredSecrets = useMemo(
    () =>
      mergedRequiredSecrets(
        declaredRequiredSecrets,
        gateMissingSecrets,
        source?.apps,
        secretsByApp,
      ),
    [declaredRequiredSecrets, gateMissingSecrets, secretsByApp, source?.apps],
  );

  const loadHistory = useCallback(() => {
    if (historyReq.current || history !== null) return;
    const requestEpoch = projectEpochRef.current;
    historyReq.current = true;
    setHistoryError(null);
    void deploymentHistory({ projectId, limit: 20 })
      .then((r) => {
        if (projectEpochRef.current === requestEpoch) setHistory(r.deployments);
      })
      .catch((err) => {
        if (projectEpochRef.current !== requestEpoch) return;
        setHistoryError(
          err instanceof Error ? err.message : "Failed to load history",
        );
        historyReq.current = false;
      });
  }, [history, projectId]);

  const loadSecrets = useCallback((applicationId: number) => {
    if (secretsReq.current.has(applicationId)) return;
    const requestEpoch = projectEpochRef.current;
    secretsReq.current.add(applicationId);
    setSecretsError(null);
    void deploymentSecrets({ applicationId })
      .then((r) => {
        if (projectEpochRef.current !== requestEpoch) return;
        setSecrets((current) => ({ ...(current ?? {}), ...r.byApp }));
      })
      .catch((err) => {
        if (projectEpochRef.current !== requestEpoch) return;
        setSecretsError(
          err instanceof Error
            ? err.message
            : "Failed to load environment variables",
        );
        secretsReq.current.delete(applicationId);
      });
  }, []);

  const refreshRequiredSecrets = useCallback(async () => {
    const requestEpoch = projectEpochRef.current;
    requiredSecretsReq.current = true;
    setRequiredSecretsError(null);
    setRequiredSecretsRetryable(true);
    try {
      const result = await deploymentRequiredSecrets({ projectId });
      if (projectEpochRef.current === requestEpoch) {
        setDeclaredRequiredSecrets(result.byApp);
      }
      return result.byApp;
    } catch (err) {
      if (projectEpochRef.current === requestEpoch) {
        setRequiredSecretsError(
          err instanceof Error
            ? err.message
            : "Failed to load required secrets",
        );
        setRequiredSecretsRetryable(isRetryableLaunchError(err));
        requiredSecretsReq.current = false;
      }
      throw err;
    }
  }, [projectId]);

  const loadRequiredSecrets = useCallback(() => {
    if (requiredSecretsReq.current || declaredRequiredSecrets !== null) return;
    void refreshRequiredSecrets().catch(() => undefined);
  }, [declaredRequiredSecrets, refreshRequiredSecrets]);

  const ensureRequiredSecrets = useCallback(
    async (apps: string[], projectIdOverride?: number) => {
      const requestEpoch = projectEpochRef.current;
      try {
        const byApp =
          projectIdOverride === undefined
            ? await refreshRequiredSecrets()
            : (
                await deploymentRequiredSecrets({
                  projectId: projectIdOverride,
                })
              ).byApp;
        if (
          projectIdOverride !== undefined &&
          projectEpochRef.current === requestEpoch
        ) {
          setDeclaredRequiredSecrets(byApp);
        }
        if (projectEpochRef.current !== requestEpoch)
          throw new Error("Project changed while checking required secrets.");
        const missing = missingRequiredSecrets(
          mergedRequiredSecrets(
            byApp,
            gateMissingSecretsRef.current,
            source?.apps,
            secretsByApp,
          ) ?? byApp,
          apps,
        );
        if (Object.keys(missing).length > 0) {
          throw new MissingRequiredSecretsError(missing);
        }
      } catch (err) {
        if (
          projectEpochRef.current === requestEpoch &&
          !(err instanceof MissingRequiredSecretsError)
        ) {
          setRequiredSecretsError(
            err instanceof Error
              ? err.message
              : "Failed to verify required secrets",
          );
          requiredSecretsReq.current = false;
        }
        throw err;
      }
    },
    [refreshRequiredSecrets, secretsByApp, source],
  );

  const hasMissingSecrets = useCallback(
    (app: string) => (requiredSecrets?.[app]?.missing.length ?? 0) > 0,
    [requiredSecrets],
  );

  const noteMissingRequiredSecrets = useCallback(
    (missing: MissingSecrets) => {
      const current = gateMissingSecretsRef.current;
      const next = Object.fromEntries(
        [...new Set([...Object.keys(current), ...Object.keys(missing)])].map(
          (app) => [
            app,
            [...new Set([...(current[app] ?? []), ...(missing[app] ?? [])])],
          ],
        ),
      );
      gateMissingSecretsRef.current = next;
      setGateMissingSecrets(next);
      persistGateMissingSecrets(projectId, next);
    },
    [projectId],
  );

  const refreshSecrets = useCallback(async (applicationId: number) => {
    const requestEpoch = projectEpochRef.current;
    setSecretsError(null);
    try {
      const r = await deploymentSecrets({ applicationId });
      if (projectEpochRef.current === requestEpoch) {
        setSecrets((current) => ({ ...(current ?? {}), ...r.byApp }));
      }
    } catch (err) {
      if (projectEpochRef.current === requestEpoch) {
        setSecretsError(
          err instanceof Error
            ? err.message
            : "Failed to load environment variables",
        );
      }
      throw err;
    }
  }, []);

  const setEnvVars = useCallback(
    async (applicationId: number, secrets: Record<string, string>) => {
      const requestEpoch = projectEpochRef.current;
      const result = await deploymentSetSecrets({
        applicationId,
        secrets,
      });
      if (projectEpochRef.current !== requestEpoch) return result;
      const nextGateMissing = Object.fromEntries(
        Object.entries(gateMissingSecretsRef.current)
          .map(([app, missing]) => {
            const application = source?.apps.find((item) => item.name === app);
            return [
              app,
              application?.id === applicationId
                ? missing.filter((name) => !(name in secrets))
                : missing,
            ] as const;
          })
          .filter(([, missing]) => missing.length > 0),
      );
      gateMissingSecretsRef.current = nextGateMissing;
      setGateMissingSecrets(nextGateMissing);
      persistGateMissingSecrets(projectId, nextGateMissing);
      await refreshSecrets(applicationId);
      if (projectEpochRef.current !== requestEpoch) return result;
      await refreshRequiredSecrets();
      return result;
    },
    [projectId, refreshRequiredSecrets, refreshSecrets, source?.apps],
  );

  const deleteEnvVar = useCallback(
    async (applicationId: number, name: string) => {
      const requestEpoch = projectEpochRef.current;
      const result = await deploymentDeleteSecret({
        applicationId,
        name,
      });
      if (projectEpochRef.current !== requestEpoch) return result;
      await refreshSecrets(applicationId);
      return result;
    },
    [refreshSecrets],
  );

  // Fetch the DB activation timeline for every app on this source (per-app but
  // all DB reads — no GitHub fan-out). `force` re-fetches after an operation.
  const fetchRecords = useCallback(async (src: UserProject) => {
    const requestEpoch = projectEpochRef.current;
    setRecordsError(null);
    try {
      const entries = await Promise.all(
        src.apps.map(async (app) => {
          const result = await deploymentRecords({
            app: app.name,
            projectId: src.id,
          });
          return [app.name, result.records] as const;
        }),
      );
      if (projectEpochRef.current === requestEpoch) {
        setRecords(Object.fromEntries(entries));
      }
    } catch (err) {
      if (projectEpochRef.current === requestEpoch) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to load deployment activity";
        setRecordsError(message);
        setRecords({});
      }
      throw err;
    }
  }, []);

  const loadRecords = useCallback(() => {
    if (recordsReq.current || recordsByApp !== null || !source) return;
    recordsReq.current = true;
    void fetchRecords(source).catch(() => {
      recordsReq.current = false;
    });
  }, [source, recordsByApp, fetchRecords]);

  const refreshRecords = useCallback(() => {
    if (!source) return;
    void fetchRecords(source).catch(() => undefined);
  }, [source, fetchRecords]);

  const promote = useCallback(
    (deploymentId: string): Promise<DeploymentPromoteResult> =>
      deploymentPromote({ deploymentId, projectId }),
    [projectId],
  );

  const deactivate = useCallback(
    (apps: string[]) => deploymentDeactivate({ projectId, apps }),
    [projectId],
  );

  // GitHub owns continuation; navigation and component lifetime cannot stop it.
  const redeploySource = useCallback(
    async (branch = "") => {
      const requestEpoch = projectEpochRef.current;
      const operation = startAttempt(branch);
      router.push(
        `/projects/${projectId}?tab=deployments&platform=${encodeURIComponent(source?.platformName ?? "community")}`,
      );
      const attempt = await operation;
      if (attempt && projectEpochRef.current === requestEpoch) await reload();
      return attempt;
    },
    [startAttempt, router, projectId, source?.platformName, reload],
  );

  // Refresh on the transition to a completed attempt, never on first sight:
  // opening a project whose latest attempt already completed must not refetch
  // what the page just loaded (double-reload waterfall, empty-list flash).
  useEffect(() => {
    if (!latestAttempt) return;
    const key = `${latestAttempt.id}:${latestAttempt.status}`;
    const seen = seenAttemptRef.current;
    seenAttemptRef.current = key;
    if (seen === undefined || seen === key) return;
    if (latestAttempt.status !== "completed") return;
    void reload();
    void refreshRequiredSecrets().catch(() => undefined);
    // Live appears right after Verify instead of on the next 10 s tick.
    void queryClient.invalidateQueries({ queryKey: runtimeKey });
  }, [
    latestAttempt,
    reload,
    refreshRequiredSecrets,
    queryClient,
    runtimeKey,
  ]);

  const upgradeSdk = useCallback(
    () => deploymentUpgradeSdk({ projectId }),
    [projectId],
  );

  // Cheap merge-poll counterpart to upgradeSdk: one GitHub-backed read, no
  // repo tarball or branch refresh, safe to call on the 45s recheck loop.
  const checkSdkUpgradeStatus = useCallback(
    () => deploymentSdkUpgradeStatus({ projectId }),
    [projectId],
  );

  return {
    source,
    runtime,
    attempts,
    loading,
    error,
    sdk,
    /** Cache namespace for account-scoped queries (null until session resolves). */
    accountKey,
    history,
    historyError,
    secretsByApp,
    secretsError,
    recordsByApp,
    recordsError,
    requiredSecrets,
    requiredSecretsError,
    requiredSecretsRetryable,
    deployFlow,
    deployStartedAt,
    loadHistory,
    loadSecrets,
    loadRequiredSecrets,
    refreshRequiredSecrets,
    ensureRequiredSecrets,
    hasMissingSecrets,
    noteMissingRequiredSecrets,
    setEnvVars,
    deleteEnvVar,
    loadRecords,
    refreshRecords,
    promote,
    deactivate,
    redeploySource,
    upgradeSdk,
    checkSdkUpgradeStatus,
    reload: () => void reload(),
  };
}
