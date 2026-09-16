import type { UserProject } from "@aomi-labs/deploy";
import {
  deploymentLifecycleFromProject,
  type DeploymentLifecycle,
} from "@aomi-labs/deploy/lifecycle";

export type ProjectDeploymentStatus = {
  lifecycle: DeploymentLifecycle;
  /** Projects-list wording (e.g. "Live deployment"). */
  label: string;
  /** StatusDot state token. */
  dotState: string;
  isLive: boolean;
  hasRecordedDeployment: boolean;
};

/**
 * One deployment story for Projects list, Home, and Deployments.
 * Always derived from `deploymentLifecycleFromProject` (same as Chat / Home).
 */
export function projectDeploymentStatus(
  source: UserProject,
): ProjectDeploymentStatus {
  const lifecycle = deploymentLifecycleFromProject(source);
  const hasRecordedDeployment =
    source.latestDeployment != null ||
    source.apps.some((app) => app.appReleaseTag != null);

  if (lifecycle.kind === "live") {
    return {
      lifecycle,
      label: "Live deployment",
      dotState: "live",
      isLive: true,
      hasRecordedDeployment,
    };
  }

  if (lifecycle.kind === "failed") {
    return {
      lifecycle,
      label: lifecycle.statusLabel,
      dotState: "failed",
      isLive: false,
      hasRecordedDeployment,
    };
  }

  if (lifecycle.kind === "build_ready") {
    return {
      lifecycle,
      label: lifecycle.statusLabel,
      dotState: "ready",
      isLive: false,
      hasRecordedDeployment,
    };
  }

  if (lifecycle.kind === "building") {
    return {
      lifecycle,
      label: lifecycle.statusLabel,
      dotState: "building",
      isLive: false,
      hasRecordedDeployment,
    };
  }

  if (hasRecordedDeployment) {
    return {
      lifecycle,
      label: "Deactivated",
      dotState: "deactivated",
      isLive: false,
      hasRecordedDeployment,
    };
  }

  return {
    lifecycle,
    // A claimed source with no apps yet is the fresh-connect state — say so
    // instead of the generic "No deployment".
    label:
      source.apps.length === 0 ? "Connected — not deployed yet" : "No deployment",
    dotState: "none",
    isLive: false,
    hasRecordedDeployment: false,
  };
}
