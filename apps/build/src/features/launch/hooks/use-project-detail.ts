"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  UserProject,
  UserProjectLatestDeployment,
} from "@aomi-labs/deploy";
import {
  deploymentProjects,
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
  launchPreflight,
  launchDeploy,
  launchStatus,
  launchActivate,
  launchAppsStatus,
} from "@build/features/launch/client";
import {
  isFatalLaunchRequestError,
  waitForAppsToLoad,
  waitForDeploymentReady,
} from "@aomi-labs/deploy/launch";
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
  ciProgress,
  stageProgress,
  type DeployFlowProgress,
} from "@build/features/launch/components/deployments/deploy-flow-progress";
import {
  buildQueryKeys,
  buildQueryStaleTime,
  githubAccountKey,
} from "../query-keys";

/** Progress of an in-flight linked-source redeploy (deploy → CI → activate). */
export type DeployFlowState =
  | { phase: "idle" }
  | { phase: "deploying"; message: string; progress?: DeployFlowProgress }
  | { phase: "building"; message: string; progress?: DeployFlowProgress }
  | { phase: "activating"; message: string; progress?: DeployFlowProgress }
  | { phase: "done"; message: string; progress?: DeployFlowProgress }
  | { phase: "error"; message: string; progress?: DeployFlowProgress };

const DEPLOY_POLL_MS = 4000;
const DEPLOYMENT_READY_TIMEOUT_MS = 8 * 60 * 1000;
const RUNTIME_READY_TIMEOUT_MS = 8 * 60 * 1000;

type MissingSecrets = Record<string, string[]>;

function missingSecretsFromLaunchError(error: unknown): MissingSecrets | null {
  if (
    !error ||
    typeof error !== "object" ||
    (error as { status?: unknown }).status !== 409
  ) {
    return null;
  }
  const body = (error as { body?: unknown }).body;
  if (!body || typeof body !== "object") return null;
  const missing = (body as { missing?: unknown }).missing;
  if (!missing || typeof missing !== "object") return null;
  const entries = Object.entries(missing).flatMap(([app, keys]) =>
    Array.isArray(keys) && keys.every((key) => typeof key === "string")
      ? [[app, keys] as const]
      : [],
  );
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

/**
 * The read endpoint reports the Manager's persisted declarations. A deploy or
 * promote 409 can be newer: it verifies the exact candidate release. Keep
 * that authoritative write-time result visible until the user sets its keys,
 * instead of collapsing the project back to "No keys required".
 */
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

function missingSecretsMessage(missing: MissingSecrets) {
  return Object.entries(missing)
    .map(([app, keys]) => `${app}: ${keys.join(", ")}`)
    .join("; ");
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
  const source = useMemo(
    () => projectsQuery.data?.projects.find((s) => s.id === projectId) ?? null,
    [projectsQuery.data, projectId],
  );
  const projectPlatform = source ? source.platformName.trim() : undefined;
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
  const [deployFlow, setDeployFlow] = useState<DeployFlowState>({
    phase: "idle",
  });
  /** Epoch ms the current deploy started, for the progress bar's clock. */
  const [deployStartedAt, setDeployStartedAt] = useState<number | null>(null);
  const historyReq = useRef(false);
  const secretsReq = useRef<Set<number>>(new Set());
  const recordsReq = useRef(false);
  const requiredSecretsReq = useRef(false);
  const gateMissingSecretsRef = useRef<MissingSecrets>({});
  const projectEpochRef = useRef(0);
  const deployAbortRef = useRef<AbortController | null>(null);
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
    setDeployFlow({ phase: "idle" });
    setDeployStartedAt(null);
    deployAbortRef.current?.abort();
    deployAbortRef.current = null;
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

  useEffect(
    () => () => {
      deployAbortRef.current?.abort();
    },
    [],
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

  // Deploy the source repo's current HEAD and activate the resulting release
  // once CI publishes it. GitHub is read only here (status polling) — the
  // "update deployment" operation — never on the passive tab render.
  const redeploySource = useCallback(async () => {
    const requestEpoch = projectEpochRef.current;
    const isCurrent = () => projectEpochRef.current === requestEpoch;
    const repo = source?.repositoryLink;
    deployAbortRef.current?.abort();
    const controller = new AbortController();
    deployAbortRef.current = controller;
    if (!repo) {
      setDeployFlow({ phase: "error", message: "Source repo is unknown." });
      deployAbortRef.current = null;
      return;
    }
    const startedAt = Date.now();
    setDeployStartedAt(startedAt);
    // CI progress is monotonic within one deploy: a transient `no_ci`/`failed`
    // poll reports the last completed step rather than snapping the bar back.
    let lastCompleted = 0;
    let ciUrl: string | null = null;
    try {
      setDeployFlow({
        phase: "deploying",
        message: "Resolving latest commit…",
        progress: stageProgress("deploying", "Resolving commit"),
      });
      const pre = await launchPreflight({
        repo,
        projectId,
      });
      if (!isCurrent()) return;
      const targetProjectId = pre.projectId ?? projectId;
      // Preflight re-syncs the source from the repo, so HEAD's `aomi.toml` can
      // register apps this page never saw. Refresh the source before gating:
      // the required-secret check runs against `pre.apps`, and both the gate
      // banner and the Environment tab list apps from `source.apps`. Without
      // this the check can fail for an app the UI has no row for — the user is
      // told a secret is missing with nowhere to enter it.
      await reload();
      if (!isCurrent()) return;
      await ensureRequiredSecrets(pre.apps, targetProjectId);
      if (!isCurrent()) return;
      if (!pre.sourceRef) {
        throw new Error("Preflight did not return an immutable source commit.");
      }
      setDeployFlow({
        phase: "deploying",
        message: "Deploying new version…",
        progress: stageProgress("deploying", "Dispatching build"),
      });
      const deployed = await launchDeploy({
        projectId: targetProjectId,
        sourceRef: pre.sourceRef,
      });
      if (!isCurrent()) return;
      const deploymentId = deployed.deployment.id;

      let releaseTags = deployed.releaseTags;
      const apps = deployed.apps;
      const ready = await waitForDeploymentReady(
        // Read the CI url here, not in `onProgress`: the watcher throws on a
        // `failed`/`no_ci` status *before* reporting progress, and that poll is
        // exactly the one whose run link the failure banner needs.
        async () => {
          const status = await launchStatus(deploymentId, projectPlatform);
          ciUrl = status.ci?.url ?? ciUrl;
          return status;
        },
        {
          signal: controller.signal,
          intervalMs: DEPLOY_POLL_MS,
          timeoutMs: DEPLOYMENT_READY_TIMEOUT_MS,
          isFatal: isFatalLaunchRequestError,
          onProgress: (status) => {
            if (!isCurrent()) return;
            releaseTags = status.releaseTags?.length
              ? status.releaseTags
              : releaseTags;
            const { model, progress } = ciProgress(status, lastCompleted);
            lastCompleted = model.completed;
            if (status.state !== "ready") {
              setDeployFlow({
                phase: "building",
                message: `Building… (${status.state})`,
                progress: { ...progress, ciUrl },
              });
            }
          },
        },
      );
      releaseTags = ready.releaseTags?.length ? ready.releaseTags : releaseTags;
      if (!isCurrent()) return;

      setDeployFlow({
        phase: "activating",
        message: "Activating release…",
        progress: stageProgress("activating", "Activating release", ciUrl),
      });
      // Activate the SAME project the deploy targeted — `targetProjectId`
      // is preflight-resolved and can differ from the page's `projectId`.
      const activated = await launchActivate({
        projectId: targetProjectId,
        releaseTags,
        apps,
      });
      if (!isCurrent()) return;
      // A rejected/partial activation still returns apps (with `error` set), and
      // a malformed response may omit `activation` entirely — surface the real
      // reason instead of throwing into the generic "Deploy failed" catch.
      const activatedApps = activated.activation?.apps ?? [];
      const failed = activatedApps.find((app) => app.error);
      if (!activated.ok || failed) {
        setDeployFlow({
          phase: "error",
          message: failed?.error ?? "Activation was not accepted.",
          progress: stageProgress("activating", "Activation failed", ciUrl),
        });
        return;
      }
      if (apps.length > 0 && activatedApps.length === 0) {
        setDeployFlow({
          phase: "error",
          message: "Activation returned no application statuses.",
          progress: stageProgress("activating", "Activation failed", ciUrl),
        });
        return;
      }
      const unloaded = activatedApps.filter((app) => !app.loaded);
      if (unloaded.length > 0) {
        setDeployFlow({
          phase: "activating",
          message: "Loading app runtime…",
          progress: stageProgress("activating", "Loading app runtime", ciUrl),
        });
        try {
          await waitForAppsToLoad(
            () => launchAppsStatus({ projectId: targetProjectId }),
            unloaded.map((app) => ({
              name: app.name,
              releaseTag: app.releaseTag ?? undefined,
            })),
            {
              signal: controller.signal,
              intervalMs: DEPLOY_POLL_MS,
              timeoutMs: RUNTIME_READY_TIMEOUT_MS,
              isFatal: isFatalLaunchRequestError,
              onProgress: ({ ready, total }) => {
                if (isCurrent()) {
                  setDeployFlow({
                    phase: "activating",
                    message: `Loading app runtime… (${ready}/${total})`,
                    progress: stageProgress(
                      "activating",
                      `Loading app runtime (${ready}/${total})`,
                      ciUrl,
                    ),
                  });
                }
              },
            },
          );
        } catch (err) {
          if (controller.signal.aborted) return;
          throw err;
        }
        if (!isCurrent()) return;
      }
      setDeployFlow({
        phase: "done",
        message: "New version is live.",
        progress: stageProgress("done", "Live", ciUrl),
      });
      await reload();
      if (!isCurrent()) return;
      refreshRecords();
    } catch (err) {
      if (controller.signal.aborted || !isCurrent()) return;
      const missing = missingSecretsFromLaunchError(err);
      if (missing) noteMissingRequiredSecrets(missing);
      setDeployFlow({
        phase: "error",
        message: missing
          ? `Missing required secrets — ${missingSecretsMessage(missing)}. Set them in Environment, then redeploy.`
          : err instanceof Error
            ? err.message
            : "Deploy failed",
        progress: { percent: 100, label: "Deploy failed", ciUrl },
      });
    } finally {
      if (deployAbortRef.current === controller) deployAbortRef.current = null;
    }
  }, [
    ensureRequiredSecrets,
    noteMissingRequiredSecrets,
    projectPlatform,
    refreshRecords,
    reload,
    source,
    projectId,
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
