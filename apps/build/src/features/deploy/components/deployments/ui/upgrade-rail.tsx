"use client";

import { useState } from "react";
import { HelpBadge } from "@build/components/help-badge";
import type { DeployFlowState } from "@build/features/launch/hooks/use-project-detail";
import type { SdkUpgradeState } from "@build/features/launch/hooks/use-sdk-upgrade";

/**
 * The SDK-upgrade lifecycle rail. Lives in the banner slot of the
 * deployments tab while an upgrade is in flight and encodes the one thing a
 * progress bar can't: who each stage is waiting on. Two stages belong to the
 * builder (merge the PR, trigger the redeploy); the rest advance on their
 * own via polling.
 */

type Step = {
  label: string;
  owner: string;
  /** Amber "waiting on you" treatment when active. */
  you?: boolean;
  hint: string;
};

const STEPS: Step[] = [
  {
    label: "Upgrade PR",
    owner: "platform",
    hint: "The platform opens a pull request in your repository bumping aomi-sdk to the required version. Your default branch is never pushed to directly.",
  },
  {
    label: "Merge PR",
    owner: "you",
    you: true,
    hint: "Merging the PR puts the required SDK on your main branch. Aomi re-checks the repository periodically and unlocks Redeploy once it's merged.",
  },
  {
    label: "Redeploy",
    owner: "you",
    you: true,
    hint: "Once the PR is merged, click Redeploy from Linked Repository to ship your repo's HEAD with the new SDK. Nothing redeploys automatically.",
  },
  {
    label: "Build",
    owner: "github",
    hint: "Redeploy commits your source bundle to the platform repository, where GitHub Actions compiles the plugin and publishes a release — usually 2–4 minutes.",
  },
  {
    label: "Live",
    owner: "",
    hint: "The Aomi runtime verifies the release digest (manifest.json) and hot-loads the new plugin. The deployment card flips to Current.",
  },
];

export type UpgradeRailStage = "pr-open" | "merged" | "building" | "live";

/** Maps the upgrade state machine + redeploy flow onto a rail stage. */
export function upgradeRailStage(
  state: SdkUpgradeState,
  deployFlow: DeployFlowState,
): UpgradeRailStage | null {
  if (state.phase === "pr-open") return "pr-open";
  if (state.phase !== "merged") return null;
  switch (deployFlow.phase) {
    case "deploying":
    case "building":
    case "activating":
      return "building";
    case "done":
      return "live";
    default:
      return "merged";
  }
}

function Stepper({ stage }: { stage: UpgradeRailStage }) {
  // Index of the active step; everything before it is done.
  const active = { "pr-open": 1, merged: 2, building: 3, live: 5 }[stage];
  return (
    <ol className="flex items-start" aria-label="SDK upgrade progress">
      {STEPS.map((step, i) => {
        const done = i < active;
        const current = i === active;
        return (
          <li
            key={step.label}
            aria-current={current ? "step" : undefined}
            className="relative flex min-w-0 flex-1 flex-col items-center text-center"
          >
            {/* connector halves */}
            {i > 0 && (
              <span
                aria-hidden
                className={`absolute left-0 top-3 h-0.5 w-1/2 ${done || current ? "bg-positive/60" : "bg-border"}`}
              />
            )}
            {i < STEPS.length - 1 && (
              <span
                aria-hidden
                className={`absolute right-0 top-3 h-0.5 w-1/2 ${done ? "bg-positive/60" : "bg-border"}`}
              />
            )}
            <span
              className={`relative z-10 grid size-6 place-items-center rounded-full border-2 text-[11px] font-bold ${
                done
                  ? "border-positive bg-positive text-primary-foreground"
                  : current
                    ? `border-warning text-warning bg-surface-1 ${step.you ? "ring-warning/25 ring-4" : ""}`
                    : "border-border text-dim bg-surface-1"
              }`}
            >
              {done ? "✓" : i + 1}
            </span>
            <span
              className={`mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold ${current ? "text-foreground" : "text-dim"}`}
            >
              {step.label}
              <HelpBadge label={`About the ${step.label} step`} side="bottom">
                {step.hint}
              </HelpBadge>
            </span>
            <span
              className={`text-[9px] uppercase tracking-wider ${current && step.you ? "text-warning" : "text-dim/70"}`}
            >
              {step.owner}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** deployFlow → the four pipeline sub-steps shown while the platform builds. */
function buildChecklist(deployFlow: DeployFlowState) {
  const reached = (phases: DeployFlowState["phase"][]) =>
    phases.includes(deployFlow.phase);
  return [
    {
      label: "Source bundle committed",
      note: "deployment.json · sha-pinned",
      state: reached(["building", "activating", "done"])
        ? "done"
        : ("running" as const),
    },
    {
      label: "Platform CI compiling plugin",
      note: "GitHub Actions",
      state: reached(["activating", "done"])
        ? "done"
        : reached(["building"])
          ? "running"
          : "todo",
    },
    {
      label: "Release published",
      note: "manifest.json + tarball",
      state: reached(["activating", "done"]) ? "done" : "todo",
    },
    {
      label: "Runtime loads new plugin",
      note: "backend poller",
      state: reached(["done"])
        ? "done"
        : reached(["activating"])
          ? "running"
          : "todo",
    },
  ] as const;
}

export function UpgradeRail({
  state,
  deployFlow,
  requiredSdk,
  repo,
  ciUrl,
  onRecheck,
  onDismiss,
}: {
  state: SdkUpgradeState;
  deployFlow: DeployFlowState;
  requiredSdk: string | null;
  repo: string | null;
  ciUrl?: string | null;
  onRecheck: () => void;
  onDismiss: () => void;
}) {
  // Terminal exits render as plain banners — no stepper to walk.
  if (state.phase === "manual") {
    return (
      <div className="border-warning/40 bg-warning/10 text-warning border-b px-4 py-2.5 text-xs">
        <span className="font-medium">Manual upgrade required. </span>
        {state.reason} Run{" "}
        <code className="bg-surface-1 rounded px-1 py-0.5 font-mono">
          {state.command}
        </code>{" "}
        in your repository, push, then redeploy.{" "}
        <button
          type="button"
          onClick={onDismiss}
          className="font-medium underline underline-offset-2"
        >
          Dismiss
        </button>
      </div>
    );
  }
  if (state.phase === "error") {
    return (
      <div className="border-destructive/30 bg-destructive/10 text-destructive flex items-center justify-between gap-3 border-b px-4 py-2.5 text-xs">
        <span>Upgrade failed: {state.message}</span>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 font-medium underline underline-offset-2"
        >
          Dismiss
        </button>
      </div>
    );
  }

  const stage = upgradeRailStage(state, deployFlow);
  if (!stage) return null;

  return (
    <div className="border-border border-b">
      <div
        className={`px-4 pb-2 pt-3 ${stage === "merged" || stage === "live" ? "bg-positive/5" : "bg-warning/5"}`}
      >
        <Stepper stage={stage} />
        {stage === "building" && (
          <ul className="border-border mt-3 grid gap-1 border-t border-dashed pt-2.5">
            {buildChecklist(deployFlow).map((row) => (
              <li
                key={row.label}
                className={`flex items-baseline gap-2 text-xs ${row.state === "todo" ? "text-dim" : "text-foreground"}`}
              >
                <span
                  aria-hidden
                  className={`w-3.5 text-center text-[11px] ${
                    row.state === "done"
                      ? "text-positive"
                      : row.state === "running"
                        ? "text-warning"
                        : "text-dim"
                  }`}
                >
                  {row.state === "done"
                    ? "✓"
                    : row.state === "running"
                      ? "●"
                      : "○"}
                </span>
                {row.label}
                <span className="text-dim ml-auto font-mono text-[10px]">
                  {row.note}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {stage === "pr-open" && state.phase === "pr-open" && (
        <div className="border-warning/40 bg-warning/10 text-warning flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2 text-xs">
          <span>
            Waiting on you — review and merge{" "}
            <span className="font-semibold">PR #{state.prNumber}</span>
            {repo ? ` in ${repo}` : ""}. Aomi re-checks periodically.
          </span>
          <span className="ml-auto flex items-center gap-3">
            <a
              href={state.prUrl}
              target="_blank"
              rel="noreferrer"
              className="font-medium underline underline-offset-2"
            >
              Review PR #{state.prNumber}
            </a>
            <button
              type="button"
              disabled={state.checking}
              onClick={onRecheck}
              className="border-warning/40 rounded border px-2 py-0.5 font-medium disabled:opacity-50"
            >
              {state.checking ? "Checking…" : "I merged it — check now"}
            </button>
          </span>
        </div>
      )}

      {stage === "merged" && state.phase === "merged" && (
        <div className="border-positive/40 bg-positive/10 text-positive border-t px-4 py-2 text-xs">
          {state.alreadyCurrent
            ? `Linked repository already requires SDK ${requiredSdk ?? ""} — no PR needed. Redeploying now…`
            : `PR merged — your repository now requires SDK ${requiredSdk ?? "the new version"}. Redeploy from the linked repository to ship it.`}
        </div>
      )}

      {stage === "building" && (
        <div className="border-warning/40 bg-warning/10 text-warning flex items-center justify-between gap-3 border-t px-4 py-2 text-xs">
          <span>Building on the platform — usually 2–4 minutes.</span>
          {ciUrl && (
            <a
              href={ciUrl}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 font-medium underline underline-offset-2"
            >
              View CI run
            </a>
          )}
        </div>
      )}

      {stage === "live" && (
        <div className="border-positive/40 bg-positive/10 text-positive flex items-center justify-between gap-3 border-t px-4 py-2 text-xs">
          <span>
            Upgraded to SDK {requiredSdk ?? "the required version"} and live.
          </span>
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 font-medium underline underline-offset-2"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Pre-flight confirmation: the single highest-leverage fix for the "surprise
 * PR" problem — before anything happens, say exactly what will.
 */
export function UpgradeConfirmDialog({
  open,
  repo,
  requiredSdk,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  repo: string | null;
  requiredSdk: string | null;
  onConfirm: (skipNextTime: boolean) => void;
  onCancel: () => void;
}) {
  const [skip, setSkip] = useState(false);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div
        role="dialog"
        aria-label="Open an upgrade pull request?"
        className="border-border bg-surface-1 w-full max-w-md rounded-lg border p-4 shadow-lg"
      >
        <div className="text-sm font-semibold">
          Open an upgrade pull request?
        </div>
        <p className="text-dim mt-2 text-sm">
          Aomi will open a PR in{" "}
          <span className="text-foreground font-medium">
            {repo ?? "your repository"}
          </span>{" "}
          changing <code className="font-mono text-xs">Cargo.toml</code> to{" "}
          <code className="font-mono text-xs">
            aomi-sdk = &quot;={requiredSdk ?? "required"}&quot;
          </code>
          . Nothing deploys until <b>you merge it</b> and redeploy.
        </p>
        <label className="text-dim mt-3 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={skip}
            onChange={(e) => setSkip(e.target.checked)}
          />
          Don&apos;t ask again
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="border-border hover:bg-accent-hover h-8 rounded-md border px-3 text-sm font-medium"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(skip)}
            className="bg-primary text-primary-foreground h-8 rounded-md px-3 text-sm font-medium hover:opacity-90"
          >
            Open upgrade PR
          </button>
        </div>
      </div>
    </div>
  );
}
