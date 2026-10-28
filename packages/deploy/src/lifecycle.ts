import type {
  ActivateResult,
  ActivatedApp,
  DeploymentStatus,
  UserProject,
} from "./types";

export type DeploymentLifecycleKind =
  | "live"
  | "build_ready"
  | "building"
  | "failed"
  | "empty";

export type DeploymentLifecycle = {
  kind: DeploymentLifecycleKind;
  repo: string;
  statusLabel: string;
  statusTone: "good" | "warning" | "bad" | "muted";
  message: string;
  appNames: string[];
  releaseTags: string[];
  chatApp?: string;
  chatApplicationId?: number;
  deploymentId?: string;
  ciStatus?: string | null;
  ciUrl?: string | null;
  branchUrl?: string | null;
  platformBranch?: string | null;
  platformRepo?: string | null;
  commitHash?: string | null;
  buildTarget?: string | null;
  progressLabel?: string;
  progressPercent?: number;
  failureReport?: string;
};

export function sourceRepositoryLabel(project: UserProject): string {
  return (
    normalizeRepo(project.repositoryLink ?? "") ??
    project.repositoryLink ??
    `project ${project.id}`
  );
}

export function deploymentLifecycleFromProject(
  project: UserProject,
): DeploymentLifecycle {
  const repo = sourceRepositoryLabel(project);
  const latest = project.latestDeployment ?? null;
  const appNames = namesFromProject(project);
  const releaseTags = tagsFromProject(project);
  const liveApp = liveAppFromProject(project);
  const ciStatus = clean(latest?.ciStatus);
  const state = clean(latest?.state)?.toLowerCase() ?? null;
  const deploymentId = clean(latest?.deploymentId) ?? undefined;
  const platformRepo = clean(latest?.platformRepo);
  const platformBranch = clean(latest?.platformBranch);

  const base = {
    repo,
    appNames,
    releaseTags,
    deploymentId,
    ciStatus,
    ciUrl: clean(latest?.ciUrl),
    branchUrl: branchUrl(platformRepo, platformBranch),
    platformBranch,
    platformRepo,
    commitHash: clean(latest?.commitHash),
    buildTarget: clean(latest?.buildTarget ?? latest?.artifactTarget),
  };

  if (liveApp) {
    return {
      ...base,
      kind: "live",
      statusLabel: "Live",
      statusTone: "good",
      message: "The latest deployment is active.",
      chatApp: liveApp.name,
      chatApplicationId: liveApp.applicationId,
    };
  }

  if (
    state === "failed" ||
    state === "no_ci" ||
    state === "skipped" ||
    ciStatus === "no_ci" ||
    ciStatus === "failed" ||
    ciStatus === "skipped" ||
    ciStatus === "stale"
  ) {
    return {
      ...base,
      kind: "failed",
      statusLabel:
        state === "no_ci" || ciStatus === "no_ci"
          ? "No CI"
          : state === "skipped" || ciStatus === "skipped"
            ? "CI skipped"
            : ciStatus === "stale"
              ? "CI stale"
              : "Build failed",
      statusTone: "bad",
      message:
        state === "no_ci" || ciStatus === "no_ci"
          ? "No CI ran for the latest deployment commit."
          : state === "skipped" || ciStatus === "skipped"
            ? "CI did not run for the latest deployment attempt."
            : "The latest deployment did not produce a usable release.",
    };
  }

  if (state === "ready" || ciStatus === "passed") {
    return {
      ...base,
      kind: "build_ready",
      statusLabel: "Build ready",
      statusTone: "warning",
      message: "Build passed and can be activated.",
    };
  }

  if (
    state === "pending" ||
    state === "building" ||
    state === "releasing" ||
    ciStatus === "pending" ||
    ciStatus === "running"
  ) {
    return {
      ...base,
      kind: "building",
      statusLabel: state === "releasing" ? "Releasing" : "Building",
      statusTone: "muted",
      message: "Waiting for platform CI and release assets.",
    };
  }

  return {
    ...base,
    kind: "empty",
    statusLabel: "Not deployed",
    statusTone: "muted",
    message: "Run a preflight to preview the deployment manifest.",
  };
}

export function deploymentIdFromReleaseTag(
  tag: string | null | undefined,
): string | null {
  const match = tag
    ?.trim()
    .match(/^apps-(\d+)-(r[a-zA-Z0-9]+)-.+-([a-fA-F0-9]{7,40})$/);
  if (!match) return null;
  return `dep_${match[1]}_${match[2]}_${match[3]}`;
}

export function deploymentLifecycleFromStatus(
  current: DeploymentLifecycle,
  status: DeploymentStatus,
): DeploymentLifecycle {
  const deployment = status.deployment;
  const platform = deployment?.platform;
  const apps = platform?.apps ?? [];
  const ciStatus =
    clean(status.ci?.status) ?? clean(platform?.ciStatus) ?? null;
  const state = status.state;
  const platformRepo =
    clean(platform?.repository) ?? current.platformRepo ?? null;
  const platformBranch =
    clean(platform?.platformBranch) ?? current.platformBranch ?? null;
  const releaseTags =
    status.releaseTags.length > 0
      ? status.releaseTags
      : apps
          .map((app) => app.releaseTag)
          .map((tag) => tag?.trim())
          .filter((tag): tag is string => Boolean(tag));
  const appNames =
    apps.length > 0
      ? apps.map((app) => app.name?.trim()).filter(Boolean)
      : current.appNames;
  const progress = progressFor(state, ciStatus);
  const failed =
    state === "failed" ||
    state === "no_ci" ||
    ciStatus === "no_ci" ||
    ciStatus === "failed" ||
    ciStatus === "skipped" ||
    ciStatus === "stale";
  const ready = state === "ready";

  return {
    ...current,
    kind: failed ? "failed" : ready ? "build_ready" : "building",
    statusLabel: failed
      ? state === "no_ci" || ciStatus === "no_ci"
        ? "No CI"
        : ciStatus === "skipped"
          ? "CI skipped"
          : ciStatus === "stale"
            ? "CI stale"
            : "Build failed"
      : ready
        ? "Build ready"
        : state === "releasing" || ciStatus === "passed"
          ? "Releasing"
          : "Building",
    statusTone: failed ? "bad" : ready ? "warning" : "muted",
    message: failed
      ? (status.message ??
        (state === "no_ci" || ciStatus === "no_ci"
          ? "No CI ran for the latest deployment commit."
          : "The latest deployment did not produce a usable release."))
      : ready
        ? "Build passed and can be activated."
        : ciStatus === "passed"
          ? "CI passed; waiting for release assets."
          : "Waiting for platform CI and release assets.",
    appNames,
    releaseTags,
    deploymentId: deployment?.id ?? current.deploymentId,
    ciStatus,
    ciUrl: clean(status.ci?.url) ?? clean(platform?.ciUrl) ?? current.ciUrl,
    branchUrl: branchUrl(platformRepo, platformBranch) ?? current.branchUrl,
    platformBranch,
    platformRepo,
    commitHash:
      clean(status.ci?.commitHash) ??
      clean(platform?.commitHash) ??
      current.commitHash,
    buildTarget:
      apps.map((app) => app.target?.trim()).find(Boolean) ??
      current.buildTarget,
    progressLabel: progress.label,
    progressPercent: progress.percent,
    failureReport: failed ? (status.message ?? undefined) : undefined,
  };
}

export function failedActivationApp(
  result: ActivateResult,
): ActivatedApp | undefined {
  return result.activation.apps.find((app) => app.error);
}

export function firstActivatedApp(
  result: ActivateResult,
): ActivatedApp | undefined {
  return result.activation.apps.find((app) => app.applicationId);
}

function clean(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function liveAppFromProject(
  project: UserProject,
): { name: string; applicationId?: number } | null {
  const latest = project.latestDeployment;
  const latestLive = latest?.apps.find(
    (app) => app.applicationId && app.isActive,
  );
  if (latestLive) {
    return {
      name: latestLive.name,
      applicationId: latestLive.applicationId ?? undefined,
    };
  }
  if (latest) return null;

  const live = project.apps.find((app) => app.isActive);
  return live ? { name: live.name, applicationId: live.id } : null;
}

function namesFromProject(project: UserProject): string[] {
  const names =
    project.latestDeployment?.apps
      .map((app) => app.name.trim())
      .filter(Boolean) ?? [];
  if (names.length > 0) return unique(names);
  return unique(project.apps.map((app) => app.name.trim()).filter(Boolean));
}

function tagsFromProject(project: UserProject): string[] {
  const latestTags = project.latestDeployment?.releaseTags ?? [];
  const cleanLatestTags = latestTags.map((tag) => tag.trim()).filter(Boolean);
  if (cleanLatestTags.length > 0) return unique(cleanLatestTags);

  return unique(
    project.apps
      .map((app) => app.appReleaseTag?.trim())
      .filter((tag): tag is string => Boolean(tag && tag !== "latest")),
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function branchUrl(
  platformRepo: string | null,
  platformBranch: string | null,
): string | null {
  if (!platformRepo || !platformBranch) return null;
  const repo = normalizeRepo(platformRepo);
  if (!repo) return null;
  return `https://github.com/${repo}/tree/${encodeURIComponent(platformBranch)}`;
}

function normalizeRepo(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let candidate = trimmed;
  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase();
    if (host !== "github.com" && host !== "www.github.com") return null;
    const [owner, repo] = url.pathname
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean);
    candidate = owner && repo ? `${owner}/${repo}` : "";
  } catch {
    candidate = trimmed.replace(/^github\.com\//i, "");
  }

  const match = candidate.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  return match ? `${match[1]}/${match[2]}` : null;
}

function progressFor(
  state: string,
  ciStatus: string | null,
): { label: string; percent: number } {
  if (state === "ready" || ciStatus === "passed") {
    return state === "ready"
      ? { label: "Build ready", percent: 100 }
      : { label: "CI passed; verifying release assets", percent: 70 };
  }
  if (state === "releasing") {
    return { label: "Verifying release assets", percent: 65 };
  }
  if (
    state === "failed" ||
    state === "no_ci" ||
    ciStatus === "no_ci" ||
    ciStatus === "failed" ||
    ciStatus === "skipped" ||
    ciStatus === "stale"
  ) {
    return {
      label:
        state === "no_ci" || ciStatus === "no_ci"
          ? "No CI"
          : ciStatus === "skipped"
            ? "CI skipped"
            : ciStatus === "stale"
              ? "CI stale"
              : "Build failed",
      percent: 100,
    };
  }
  if (state === "pending" || ciStatus === "pending") {
    return { label: "Waiting for CI", percent: 15 };
  }
  return { label: "Building CI", percent: 25 };
}
