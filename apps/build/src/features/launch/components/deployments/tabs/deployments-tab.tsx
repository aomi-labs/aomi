"use client";

import { useEffect, useMemo, useState } from "react";
import { PowerOff, Rocket } from "lucide-react";
import { EmptyState } from "@build/components/control-plane/empty-state";
import { useToast } from "@build/components/control-plane/toast";
import { useProjectDetail } from "@build/features/launch/hooks/use-project-detail";
import { useSdkUpgrade } from "@build/features/launch/hooks/use-sdk-upgrade";
import { projectDeploymentStatus } from "../project-deployment-status";
import { TimelineDeploymentRow } from "../ui/timeline-deployment-row";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { DeploymentDetail } from "../ui/deployment-detail";
import { RequiredSecretsPanel } from "@build/features/launch/components/required-secrets-panel";
import { UpgradeConfirmDialog, UpgradeRail } from "../ui/upgrade-rail";
import { LoadingPanel, EmptyPanel } from "../ui/state-panels";
import { DeployProgressBar } from "../ui/deploy-progress-bar";
import {
  buildActivityList,
  buildDeploymentList,
  promoteBlockedReason,
  sortDeploymentsForTimeline,
} from "../deployment-timeline";
import { formatRelativeTime } from "../format-relative-time";

type Detail = ReturnType<typeof useProjectDetail>;
type OpState = {
  kind: "promote" | "deactivate";
  deploymentId: string;
  status: "running" | "done" | "error";
  message: string;
};
type Pending =
  | { kind: "promote"; deploymentId: string }
  | { kind: "deactivate"; deploymentId: string; apps: string[] }
  | null;
type View = "deployments" | "activity";

export function DeploymentsTab({
  detail,
  onOpenEnvironment,
}: {
  detail: Detail;
  onOpenEnvironment?: () => void;
}) {
  const { toast } = useToast();
  const [op, setOp] = useState<OpState | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [view, setView] = useState<View>("deployments");
  const [expandedDetail, setExpandedDetail] = useState<string | null>(null);
  const { loadHistory, loadRecords, loadRequiredSecrets } = detail;

  useEffect(() => {
    loadHistory();
    loadRecords();
    loadRequiredSecrets();
  }, [loadHistory, loadRecords, loadRequiredSecrets]);

  const source = detail.source;
  const upgrade = useSdkUpgrade({
    projectId: source?.id ?? null,
    upgrade: detail.upgradeSdk,
    checkStatus: detail.checkSdkUpgradeStatus,
    // Repo already satisfies the required SDK: no PR to wait on, ship it.
    onAlreadyCurrent: () => void detail.redeploySource(),
  });
  // Platform-side context for the detail panels, resolved lazily from history.
  const history = detail.history;
  const entryById = useMemo(
    () =>
      new Map(
        (history ?? [])
          .filter((entry) => entry.deploymentId != null)
          .map((entry) => [entry.deploymentId as string, entry]),
      ),
    [history],
  );
  const platformRepo = useMemo(
    () =>
      history?.find((entry) => entry.platformRepo)?.platformRepo ??
      detail.source?.latestDeployment?.platformRepo ??
      null,
    [history, detail.source],
  );
  const status = useMemo(
    () => (source ? projectDeploymentStatus(source) : null),
    [source],
  );
  const recordDeployments = useMemo(
    () => buildDeploymentList(detail.recordsByApp, detail.history),
    [detail.history, detail.recordsByApp],
  );
  const activity = useMemo(
    () => buildActivityList(detail.recordsByApp),
    [detail.recordsByApp],
  );
  const runtimeHasActiveState =
    source?.apps.some((app) => typeof app.isActive === "boolean") ?? false;
  const activeAppMissingReleaseTag =
    source?.apps.some((app) => app.isActive && app.appReleaseTag == null) ??
    false;
  const runtimeCanResolveLive =
    runtimeHasActiveState && !activeAppMissingReleaseTag;
  const optimisticallyPromotedId =
    op?.kind === "promote" && op.status === "done" ? op.deploymentId : null;
  const optimisticallyDeactivated =
    op?.kind === "deactivate" && op.status === "done";
  const liveReleaseTags = useMemo(
    () =>
      new Set(
        optimisticallyDeactivated
          ? []
          : (source?.apps
              .filter(
                (app) => app.isActive && typeof app.appReleaseTag === "string",
              )
              .map((app) => app.appReleaseTag as string) ?? []),
      ),
    [source, optimisticallyDeactivated],
  );
  const deployments = useMemo(
    () =>
      sortDeploymentsForTimeline(
        recordDeployments.map((deployment) => ({
          ...deployment,
          current: optimisticallyPromotedId
            ? deployment.deploymentId === optimisticallyPromotedId
            : runtimeCanResolveLive
              ? deployment.releaseTags.some((tag) => liveReleaseTags.has(tag))
              : deployment.current,
        })),
      ),
    [
      recordDeployments,
      optimisticallyPromotedId,
      runtimeCanResolveLive,
      liveReleaseTags,
    ],
  );
  const currentDeployment =
    deployments.find((deployment) => deployment.current) ?? null;
  const requiredSdk = detail.sdk?.sdkStatus.requiredVersion ?? null;
  const deactivated =
    runtimeCanResolveLive &&
    detail.history !== null &&
    deployments.length > 0 &&
    currentDeployment == null;
  const deploying =
    detail.deployFlow.phase !== "idle" &&
    detail.deployFlow.phase !== "done" &&
    detail.deployFlow.phase !== "error";
  // Redeploy is pointless mid-upgrade: it would ship the old SDK again.
  const upgradeGate =
    upgrade.state.phase === "pr-open" || upgrade.state.phase === "opening";
  const deactivatingCurrent =
    currentDeployment != null &&
    op?.deploymentId === currentDeployment.deploymentId &&
    op.status === "running";
  const runtimeByApp = useMemo(
    () => new Map(source?.apps.map((app) => [app.name, app]) ?? []),
    [source],
  );
  // A deploy re-syncs the source from the repo and gates on the apps that come
  // back, which can include an app this page's source snapshot predates. Gate
  // on the union so the banner never goes silent for an app the check flagged.
  const gateApps = useMemo(() => {
    const names = source?.apps.map((app) => app.name) ?? [];
    const known = new Set(names);
    for (const name of Object.keys(detail.requiredSecrets ?? {})) {
      if (!known.has(name)) names.push(name);
    }
    return names;
  }, [source, detail.requiredSecrets]);
  const missingRequiredApps = useMemo(
    () => gateApps.filter((app) => detail.hasMissingSecrets(app)),
    [detail, gateApps],
  );
  const secretsCheckPending = Boolean(
    source &&
    gateApps.length > 0 &&
    detail.requiredSecrets === null &&
    !detail.requiredSecretsError,
  );
  const secretsCheckFailed = Boolean(
    source && gateApps.length > 0 && detail.requiredSecretsError,
  );
  const secretsGateBlocked = Boolean(
    source &&
    gateApps.length > 0 &&
    (secretsCheckPending ||
      secretsCheckFailed ||
      missingRequiredApps.length > 0),
  );
  const missingRequiredCount =
    missingRequiredApps.reduce(
      (count, app) =>
        count + (detail.requiredSecrets?.[app]?.missing.length ?? 0),
      0,
    ) || missingRequiredApps.length;

  const missingSecretSlots = missingRequiredApps.flatMap((app) =>
    (detail.requiredSecrets?.[app]?.slots ?? [])
      .filter((slot) =>
        detail.requiredSecrets?.[app]?.missing.includes(slot.name),
      )
      .map((slot) => ({
        app,
        slot,
        applicationId: detail.requiredSecrets?.[app]?.applicationId,
      })),
  );

  const saveRequiredSecrets = async (
    valuesByApplication: Map<number, Record<string, string>>,
  ) => {
    await Promise.all(
      Array.from(valuesByApplication, ([applicationId, values]) =>
        detail.setEnvVars?.(applicationId, values),
      ),
    );
    await detail.ensureRequiredSecrets?.(missingRequiredApps);
  };

  if (!source) {
    return detail.loading ? (
      <LoadingPanel label="Loading project…" />
    ) : (
      <EmptyPanel>Project not found.</EmptyPanel>
    );
  }
  // The canonical record timeline establishes the UI's current state. History
  // enriches it independently, so render records while that request is pending.
  if (detail.recordsByApp === null) {
    return <LoadingPanel label="Loading deployments…" />;
  }

  const runPromote = async (deploymentId: string) => {
    setPending(null);
    setOp({
      kind: "promote",
      deploymentId,
      status: "running",
      message: "Promoting…",
    });
    try {
      const result = await detail.promote(deploymentId);
      setOp({
        kind: "promote",
        deploymentId,
        status: result.ok ? "done" : "error",
        message: result.ok
          ? `Promoted ${result.promote.releaseTags.length} release tag(s).`
          : result.promote.status,
      });
      toast({
        title: result.ok ? "Promoted" : "Failed. Retry",
        tone: result.ok ? "success" : "error",
      });
      detail.reload();
      detail.refreshRecords();
    } catch (err) {
      const missing = (err as { body?: { missing?: Record<string, string[]> } })
        .body?.missing;
      if (missing) detail.noteMissingRequiredSecrets(missing);
      setOp({
        kind: "promote",
        deploymentId,
        status: "error",
        message: missing
          ? "Required secrets are missing. Set them below before promoting."
          : err instanceof Error
            ? err.message
            : "Promote failed",
      });
      toast({ title: "Failed. Retry", tone: "error" });
    }
  };

  const runDeactivate = async (deploymentId: string, apps: string[]) => {
    setPending(null);
    setOp({
      kind: "deactivate",
      deploymentId,
      status: "running",
      message: "Deactivating…",
    });
    try {
      await detail.deactivate(apps);
      setOp({
        kind: "deactivate",
        deploymentId,
        status: "done",
        message: "Deactivated.",
      });
      toast({ title: "Deactivated", tone: "success" });
      detail.reload();
      detail.refreshRecords();
    } catch (err) {
      setOp({
        kind: "deactivate",
        deploymentId,
        status: "error",
        message: err instanceof Error ? err.message : "Deactivate failed",
      });
      toast({ title: "Failed. Retry", tone: "error" });
    }
  };

  const historyCountLabel =
    deployments.length === 1
      ? "1 deployment in history"
      : `${deployments.length} deployments in history`;
  const summaryLabel = status?.isLive
    ? currentDeployment
      ? `Live · ${currentDeployment.apps.join(", ") || "app"} · ${historyCountLabel}`
      : `Live · ${historyCountLabel}`
    : deactivated
      ? `Deactivated · ${historyCountLabel}`
      : deployments.length > 0
        ? historyCountLabel
        : (status?.label ?? "No deployment");

  return (
    <div>
      <div className="border-border text-dim border-b px-4 py-2 text-xs">
        <span className="text-foreground font-medium">{summaryLabel}</span>
        <span className="text-dim"> · </span>
        Newest and current first. Promote an older release to make it live.
      </div>
      <div className="border-border flex items-center justify-between gap-3 border-b px-4 py-3">
        <div
          role="tablist"
          aria-label="Deployment views"
          className="border-border bg-surface-1 inline-grid h-9 grid-cols-2 rounded-md border p-0.5"
        >
          {[
            ["deployments", "History"],
            ["activity", "Promotions"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={view === id}
              onClick={() => setView(id as View)}
              className={`h-full w-24 rounded px-2.5 text-xs font-medium ${
                view === id
                  ? "bg-primary text-primary-foreground"
                  : "text-dim hover:bg-accent-hover"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {(currentDeployment || deactivated) && (
            <button
              type="button"
              disabled={deploying || deactivatingCurrent || deactivated}
              onClick={() =>
                currentDeployment
                  ? setPending({
                      kind: "deactivate",
                      deploymentId: currentDeployment.deploymentId,
                      apps: currentDeployment.apps,
                    })
                  : undefined
              }
              className="border-border bg-surface-1 text-foreground hover:bg-accent-hover inline-flex h-9 items-center justify-center gap-1.5 rounded-md border px-2.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
              title={
                deactivated
                  ? "No deployment is live"
                  : "Deactivate: unload the binary and clear the live pointer"
              }
            >
              <PowerOff className="size-3.5" aria-hidden />
              Deactivate
            </button>
          )}
          <div className="flex flex-col items-end gap-0.5">
            <button
              type="button"
              disabled={deploying || secretsGateBlocked || upgradeGate}
              onClick={() => {
                setOp(null);
                void detail.redeploySource();
              }}
              className="bg-primary text-primary-foreground inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-xs font-medium hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              title={
                upgradeGate
                  ? "Unlocks when the SDK upgrade PR merges"
                  : "Deploy the source repo's latest commit and activate it"
              }
            >
              <Rocket className="size-3.5" aria-hidden />
              {deploying ? "Deploying…" : "Redeploy from Linked Repository"}
            </button>
            {upgradeGate && (
              <span className="text-dim text-[10px]">
                unlocks when the upgrade PR merges
              </span>
            )}
          </div>
        </div>
      </div>

      <UpgradeRail
        state={upgrade.state}
        deployFlow={detail.deployFlow}
        requiredSdk={requiredSdk}
        repo={source.repositoryLink}
        ciUrl={source.latestDeployment?.ciUrl ?? null}
        onRecheck={() => void upgrade.recheck()}
        onDismiss={upgrade.dismiss}
      />

      <DeployProgressBar
        deployFlow={detail.deployFlow}
        startedAt={detail.deployStartedAt ?? null}
      />

      {deactivated && (
        <div className="border-destructive/30 bg-destructive/10 text-destructive flex items-center gap-2 border-b px-4 py-2 text-xs">
          <span className="bg-destructive/20 rounded-full px-2 py-0.5 font-medium">
            Deactivated
          </span>
          <span>
            No deployment is currently live. Promote a deployment or deploy a
            new version.
          </span>
        </div>
      )}

      {detail.recordsError && (
        <div className="border-destructive/30 bg-destructive/10 text-destructive border-b px-4 py-2 text-xs">
          {detail.recordsError}
        </div>
      )}

      {secretsGateBlocked && (
        <div className="border-b px-4 py-3">
          <RequiredSecretsPanel
            slots={missingSecretSlots}
            missingCount={missingRequiredCount}
            verificationError={
              detail.requiredSecretsError
                ? `${detail.requiredSecretsError}.`
                : null
            }
            verificationRetryable={detail.requiredSecretsRetryable ?? true}
            pending={secretsCheckPending}
            onRetryVerification={detail.refreshRequiredSecrets}
            onSave={saveRequiredSecrets}
            actionLabel="Promote"
          />
          {onOpenEnvironment && !secretsCheckPending && (
            // The panel fixes what is missing; this still goes to the full
            // Environment tab for everything else the project has set.
            <button
              type="button"
              onClick={onOpenEnvironment}
              className="text-warning mt-2 text-xs font-medium underline underline-offset-2"
            >
              Set required secrets
            </button>
          )}
        </div>
      )}

      {view === "deployments" &&
      deployments.length === 0 &&
      !detail.recordsError ? (
        <EmptyState
          title={
            status?.isLive ? "No deployment history yet" : "No deployments yet"
          }
          description={
            status?.isLive
              ? "This project is live, but no deployment records are available yet. Deploy a new version to start a history."
              : "Deploy the current version from the linked repository."
          }
          onAction={() =>
            secretsGateBlocked
              ? onOpenEnvironment?.()
              : void detail.redeploySource()
          }
          actionLabel={
            secretsGateBlocked
              ? "Set required secrets"
              : "Deploy from Linked Repository"
          }
        />
      ) : view === "deployments" && deployments.length > 0 ? (
        deployments.map((deployment) => {
          // Any running operation in this project blocks promotion, not only
          // one on this row: two promotions in the same project dispatch two
          // CI runs that queue behind each other just the same.
          const running = op?.status === "running";
          const message =
            op?.deploymentId === deployment.deploymentId ? op.message : null;
          const hasUnloadedCurrentApp =
            deployment.current &&
            deployment.apps.some((appName) => {
              const app = runtimeByApp.get(appName);
              return (
                app?.isActive === true &&
                app.loaded === false &&
                app.appReleaseTag != null &&
                deployment.releaseTags.includes(app.appReleaseTag)
              );
            });
          const secretsBlocked = deployment.apps.some((app) =>
            detail.hasMissingSecrets(app),
          );
          const promoteBlocked = promoteBlockedReason(deployment, {
            busy: running,
            secretsBlocked,
          });
          return (
            <div key={deployment.deploymentId}>
              <TimelineDeploymentRow
                deployment={deployment}
                busy={running}
                promoteBlocked={promoteBlocked}
                message={message}
                runtimeState={hasUnloadedCurrentApp ? "not-loaded" : "loaded"}
                requiredSdk={requiredSdk}
                secretsBlocked={secretsBlocked}
                onPromote={() =>
                  setPending({
                    kind: "promote",
                    deploymentId: deployment.deploymentId,
                  })
                }
                onUpgrade={upgrade.requestUpgrade}
                upgradePr={
                  upgrade.state.phase === "pr-open"
                    ? {
                        url: upgrade.state.prUrl,
                        number: upgrade.state.prNumber,
                      }
                    : null
                }
                upgradeBusy={upgrade.state.phase === "opening"}
              />
              <DeploymentDetail
                deployment={deployment}
                source={source}
                requiredSdk={requiredSdk}
                entry={entryById.get(deployment.deploymentId) ?? null}
                platformRepo={platformRepo}
                historyPending={history === null && !detail.historyError}
                expanded={expandedDetail === deployment.deploymentId}
                onToggle={() => {
                  setExpandedDetail((prev) =>
                    prev === deployment.deploymentId
                      ? null
                      : deployment.deploymentId,
                  );
                  detail.loadHistory();
                }}
              />
            </div>
          );
        })
      ) : null}

      {view === "activity" && activity.length === 0 && !detail.recordsError && (
        <EmptyPanel>
          No promotions recorded yet. Promote a deployment to see it here.
        </EmptyPanel>
      )}

      {view === "activity" && activity.length > 0 && (
        <div>
          {activity.map((row) => (
            <div
              key={`${row.app}-${row.deploymentId}-${row.releaseTag}-${row.createdAt}`}
              className="border-border text-dim flex min-h-10 items-center justify-between gap-4 border-b px-4 py-2 text-xs last:border-b-0"
            >
              <span className="min-w-0 truncate">
                <span className="text-foreground font-medium">{row.app}</span>
                <span className="text-dim"> · promoted · </span>
                <span className="font-mono">{row.deploymentId}</span>
              </span>
              <span
                className="shrink-0 text-right"
                title={new Date(row.createdAt * 1000).toLocaleString()}
              >
                {row.current ? "current · " : ""}
                {row.actor ? `${row.actor} · ` : ""}
                {formatRelativeTime(row.createdAt)}
              </span>
            </div>
          ))}
        </div>
      )}

      <UpgradeConfirmDialog
        open={upgrade.state.phase === "confirm"}
        repo={source.repositoryLink}
        requiredSdk={requiredSdk}
        onConfirm={(skipNextTime) => upgrade.confirm(skipNextTime)}
        onCancel={upgrade.cancel}
      />

      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.kind === "deactivate"
            ? "Deactivate deployment?"
            : "Promote deployment?"
        }
        body={
          pending?.kind === "deactivate"
            ? "This unloads the running binary and clears the live pointer. The deployment record and history are kept."
            : "This makes the deployment's release live. Cross-SDK promotions are blocked by the backend."
        }
        confirmLabel={pending?.kind === "deactivate" ? "Deactivate" : "Promote"}
        onConfirm={() => {
          if (pending?.kind === "promote") {
            void runPromote(pending.deploymentId);
          } else if (pending?.kind === "deactivate") {
            void runDeactivate(pending.deploymentId, pending.apps);
          }
        }}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
