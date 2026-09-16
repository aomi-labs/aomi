import type { DeploymentStatus, ProgressModel } from "@aomi-labs/deploy";
import { deploymentProgress } from "@aomi-labs/deploy/launch";

/**
 * Progress of a linked-source redeploy, expressed over the WHOLE pipeline
 * (deploy → CI → activate → live) rather than over CI alone. The deployments
 * tab used to show only `deployFlow.message`, so a redeploy read as a frozen
 * "Building… (building)" line for the two-to-four minutes CI takes — the same
 * wait the onboarding deploy step has always drawn a bar for.
 */
export type DeployFlowProgress = {
  /** 0–100, monotonic within one deploy. */
  percent: number;
  /** Short phase label, e.g. "Building CI". */
  label: string;
  /** GitHub Actions run for this deployment, once CI reports one. */
  ciUrl?: string | null;
};

/** Share of the bar each pipeline stage owns. CI dominates the wall clock. */
const DEPLOY_START = 4;
const CI_START = 12;
const CI_END = 78;
const ACTIVATE_END = 96;

/** CI's own `completed/total` mapped into the bar's CI segment. */
export function ciProgress(
  status: DeploymentStatus,
  lastCompleted: number,
): { model: ProgressModel; progress: DeployFlowProgress } {
  const model = deploymentProgress(status, lastCompleted);
  const fraction = model.total > 0 ? model.completed / model.total : 0;
  return {
    model,
    progress: {
      percent: Math.round(
        CI_START + Math.min(Math.max(fraction, 0), 1) * (CI_END - CI_START),
      ),
      label: model.label,
      ciUrl: status.ci?.url ?? null,
    },
  };
}

/** Progress for the stages that have no CI status to read: before and after. */
export function stageProgress(
  stage: "deploying" | "activating" | "done",
  label: string,
  ciUrl?: string | null,
): DeployFlowProgress {
  const percent =
    stage === "deploying"
      ? DEPLOY_START
      : stage === "activating"
        ? ACTIVATE_END
        : 100;
  return { percent, label, ciUrl: ciUrl ?? null };
}
