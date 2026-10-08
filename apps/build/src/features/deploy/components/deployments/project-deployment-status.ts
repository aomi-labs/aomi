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

  // `loaded` is a runtime probe result. Rows that never probed (`undefined`,
  // the Projects index) say "Activated" rather than claiming a verification
  // that did not run; a probe that answered `false` is the unverified case.
  if (
    lifecycle.kind === "live" &&
    source.apps.some((app) => app.loaded === undefined)
  ) {
    return {
      lifecycle,
      label: "Activated",
      dotState: "ready",
      isLive: false,
      hasRecordedDeployment,
    };
  }

  if (
    lifecycle.kind === "live" &&
    !source.apps.every((app) => app.isActive && app.loaded === true)
  ) {
    return {
      lifecycle,
      label: "Activated — runtime not verified",
      dotState: "building",
      isLive: false,
      hasRecordedDeployment,
    };
  }

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
      source.apps.length === 0
        ? "Connected — not deployed yet"
        : "No deployment",
    dotState: "none",
    isLive: false,
    hasRecordedDeployment: false,
  };
}
