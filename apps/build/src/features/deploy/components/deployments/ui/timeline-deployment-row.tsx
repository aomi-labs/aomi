import {
  CircleArrowUp,
  ExternalLink,
  GitCommitHorizontal,
  RotateCcw,
} from "lucide-react";
import { HelpBadge } from "@build/components/help-badge";
import {
  deploymentIsBuilding,
  type TimelineDeployment,
} from "../deployment-timeline";
import { formatRelativeTime } from "../format-relative-time";
import { sdkCompatibility } from "../sdk-compatibility";

/** Deployment row from DB promotion records. Lead with apps + status; id is secondary. */
export function TimelineDeploymentRow({
  deployment,
  busy,
  message,
  runtimeState,
  requiredSdk,
  secretsBlocked,
  promoteBlocked,
  onPromote,
  onUpgrade,
  upgradePr,
  upgradeBusy,
}: {
  deployment: TimelineDeployment;
  busy: boolean;
  message?: string | null;
  runtimeState?: "loaded" | "not-loaded";
  requiredSdk?: string | null;
  secretsBlocked?: boolean;
  /**
   * Why promotion is unavailable, or null when it is available. Shown as the
   * button's tooltip, so the disabled state explains itself. Undefined means
   * the caller has not adopted this yet and the legacy busy/secrets gate
   * applies.
   */
  promoteBlocked?: string | null;
  onPromote: () => void;
  onUpgrade?: () => void;
  /** Open upgrade PR: replaces the Upgrade button with a review link. */
  upgradePr?: { url: string; number: number } | null;
  /** True while the upgrade PR is being opened. */
  upgradeBusy?: boolean;
}) {
  const { deploymentId, commit, apps, current, actor, sdkVersion, createdAt } =
    deployment;
  const title = apps.join(", ") || "Deployment";
  const absolute = new Date(createdAt * 1000).toLocaleString();
  const building = deploymentIsBuilding(deployment);
  const outdated =
    current && sdkCompatibility(sdkVersion, requiredSdk) === "outdated";

  return (
    <div
      className={`border-border grid min-h-[76px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b px-4 py-3 last:border-b-0 ${
        outdated ? "bg-warning/10" : current ? "bg-positive/5" : ""
      }`}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <div className="truncate text-sm font-medium">{title}</div>
          {current && (
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                outdated || runtimeState === "not-loaded"
                  ? "bg-warning/10 text-warning"
                  : "bg-positive/10 text-positive"
              }`}
            >
              {outdated
                ? "Outdated"
                : runtimeState === "not-loaded"
                  ? "Selected, not loaded"
                  : "Current"}
            </span>
          )}
        </div>
        <div className="text-dim mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1 font-mono">
            <GitCommitHorizontal className="size-3.5" aria-hidden />
            {commit ?? "unknown"}
          </span>
          {sdkVersion && (
            <span>
              sdk {sdkVersion}
              {outdated && requiredSdk ? ` · requires ${requiredSdk}` : ""}
            </span>
          )}
          {actor && <span>{actor}</span>}
          <span title={absolute}>{formatRelativeTime(createdAt)}</span>
        </div>
        <div className="text-dim mt-1 truncate font-mono text-[11px]">
          {deploymentId}
        </div>
        {message && <div className="text-dim mt-1 text-xs">{message}</div>}
        {!current && secretsBlocked && (
          <div className="mt-1 text-xs text-amber-700">
            Required secrets missing — set them in the Environment tab.
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        {outdated && upgradePr ? (
          <a
            href={upgradePr.url}
            target="_blank"
            rel="noreferrer"
            className="border-border bg-surface-1 text-foreground hover:bg-accent-hover inline-flex h-8 items-center justify-center gap-1.5 rounded-md border px-2.5 text-xs font-medium"
          >
            Review PR #{upgradePr.number}
            <ExternalLink className="size-3" aria-hidden />
          </a>
        ) : outdated && onUpgrade ? (
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              disabled={busy || upgradeBusy}
              onClick={onUpgrade}
              className="border-warning/40 bg-warning/10 text-warning hover:bg-warning/15 inline-flex h-8 items-center justify-center gap-1.5 rounded-md border px-2.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CircleArrowUp className="size-3.5" aria-hidden />
              {upgradeBusy ? "Opening PR…" : `Upgrade to ${requiredSdk}`}
            </button>
            <span className="text-dim inline-flex items-center gap-1 text-[10px]">
              via pull request
              <HelpBadge label="Why a pull request">
                Aomi never pushes to your default branch. Upgrades arrive as a
                pull request in your repository — you review the one-line
                Cargo.toml change and merge when ready.
              </HelpBadge>
            </span>
          </div>
        ) : null}
        {!current && (
          <button
            type="button"
            // `promoteBlocked` supersedes the older busy/secrets pair and
            // additionally covers "this deployment is still building". The
            // fallback keeps the previous behaviour for any call site that
            // has not been updated to pass a reason.
            disabled={
              promoteBlocked !== undefined
                ? promoteBlocked !== null
                : busy || secretsBlocked
            }
            onClick={onPromote}
            className="border-border bg-surface-1 text-foreground hover:bg-accent-hover inline-flex h-8 items-center justify-center gap-1.5 rounded-md border px-2.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
            title={
              promoteBlocked ??
              // No "go to the Environment tab" here any more: the panel below
              // this row takes the values directly, so pointing elsewhere would
              // send the builder away from the thing that can fix it.
              (secretsBlocked
                ? "Required secrets missing"
                : "Promote this deployment to live")
            }
          >
            <RotateCcw className="size-3.5" aria-hidden />
            {building ? "Building…" : "Promote"}
          </button>
        )}
      </div>
    </div>
  );
}
