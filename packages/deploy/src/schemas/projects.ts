/** Builder projects, their deployments, GitHub access, application keys and sign-in. */
import { z } from "zod";

import { DeployError } from "../errors";
import { PlatformApp, Project, projectFields } from "./deploy";
import { confirmed, dict, flag, list, maybe, maybeNum, maybeText, num, oneOf, opaque, positive, strict, strings, text, wire } from "./wire";

const DeploymentApp = wire({
  name: text(),
  releaseTag: maybeText,
  sdkVersion: maybeText,
  target: maybeText,
  applicationId: maybeNum,
  projectId: maybeNum,
  appReleaseTag: maybeText,
  isActive: flag,
  artifactReady: flag,
  loaded: flag,
});
export type UserProjectDeploymentApp = z.output<typeof DeploymentApp>;

const createdAt = z.unknown().transform((value) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DeployError("BACKEND", "backend deployment response is missing created_at");
  }
  return value;
});

const deployment = {
  deploymentId: maybeText,
  state: maybeText,
  /** Generated branch in the platform repository for this deployment. */
  platformBranch: maybeText,
  platformRepo: maybeText,
  commitHash: maybeText,
  ciStatus: maybeText,
  ciUrl: maybeText,
  ciRunId: opaque<string | number>(),
  releaseTags: strings,
  sdkVersion: maybeText,
  artifactTarget: maybeText,
  buildTarget: maybeText,
  /** Epoch seconds of the deploy request. */
  createdAt,
  apps: list(DeploymentApp),
};
const deploymentAliases = {
  deploymentId: ["id"],
  state: ["status"],
  platformRepo: ["repository"],
  ciStatus: ["ci.status"],
  ciUrl: ["ci.url"],
  buildTarget: ["target"],
};

export const UserProjectLatestDeployment = wire(deployment, deploymentAliases);
export type UserProjectLatestDeployment = z.output<typeof UserProjectLatestDeployment>;

/** A deployment in the account-wide feed; one without a valid project reads null. */
export const UserDeployment = wire({ ...deployment, projectId: num(), repositoryLink: text() }, deploymentAliases).transform(
  (row) => (Number.isSafeInteger(row.projectId) && row.projectId > 0 ? row : null),
);
export type UserDeployment = NonNullable<z.output<typeof UserDeployment>>;

/** The feed's next page, or null when the manager sends no complete cursor. */
export const UserDeploymentsCursor = maybe(wire({ createdAt: num(), id: num() })).transform((cursor) =>
  cursor && Number.isSafeInteger(cursor.createdAt) && Number.isSafeInteger(cursor.id) ? cursor : null,
);
export type UserDeploymentsCursor = NonNullable<z.output<typeof UserDeploymentsCursor>>;

export const UserDeploymentsPage = wire({
  deployments: list(UserDeployment).transform((rows) => rows.filter((row) => row !== null)),
  nextCursor: UserDeploymentsCursor,
});
export type UserDeploymentsPage = z.output<typeof UserDeploymentsPage>;

const ApplicationManifest = wire({ path: text(), name: text(), sdkVersion: maybeText, ffiVersion: positive, target: text() });
export type ProjectApplicationManifest = z.output<typeof ApplicationManifest>;

const INVALID_REASONS = [
  "config-missing",
  "config-invalid",
  "manifest-missing",
  "manifest-invalid",
  "application-name-conflict",
  "platform-mismatch",
] as const;

const Configuration = z.union([
  wire({ status: z.literal("valid"), revision: text(), configHash: text(), applications: list(ApplicationManifest) }),
  wire({
    status: z.literal("invalid"),
    checkedRevision: text(),
    reason: oneOf(INVALID_REASONS, "config-invalid"),
    lastValidRevision: maybeText,
  }),
]);
export type ProjectConfiguration = z.output<typeof Configuration>;

/** The project's `aomi.toml` check; absent or of an unknown status, undefined. */
const ProjectConfiguration = z.unknown().transform((value) => Configuration.safeParse(value).data);

const platformName = z.unknown().transform((value) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new DeployError("BACKEND", "backend Project response is missing its platform binding");
  }
  return value.trim();
});

const positives = z.unknown().transform((value) =>
  Array.isArray(value) ? value.filter((entry): entry is number => Number.isInteger(entry) && entry > 0) : [],
);

/** A platform-bound project plus its applications. */
export const UserProject = wire({
  ...projectFields,
  platformName,
  apps: list(PlatformApp),
  configuration: ProjectConfiguration,
  latestDeployment: maybe(UserProjectLatestDeployment),
  /** SDK version of the project's live app, from DB promotion records. */
  sdkVersion: maybeText,
  /** All distinct SDK versions running across this project's live apps. */
  sdkVersions: strings,
  /** Verified contract of the live apps; independent of SDK release numbers. */
  ffiVersion: positive,
  ffiVersions: positives,
  requiredFfiVersion: positive,
  ffiUnrecorded: confirmed,
  /** A live app cannot load on this backend: its verified FFI is not the backend's, or its
   *  recorded SDK maps to no verified FFI. Distinct from `ffiUnrecorded`, a missing record. */
  ffiIncompatible: confirmed,
  /** Recorded SDKs of live apps with no verified FFI: the ones `ffiIncompatible` names. */
  ffiUnverifiedSdkVersions: strings,
});
export type UserProject = z.output<typeof UserProject>;

/** One project's apps with their live flags. */
export const UserProjectAppsResult = wire({ project: Project, platform: text(), apps: list(PlatformApp) });
export type UserProjectAppsResult = z.output<typeof UserProjectAppsResult>;

export const BuilderApplication = wire({ project: Project, platform: text(), application: PlatformApp });
export type BuilderApplication = z.output<typeof BuilderApplication>;

const ACCESS_STATUSES = ["ok", "missing_permissions", "suspended", "not_installed", "error"] as const;
export type GitHubRepositoryAccessStatus = (typeof ACCESS_STATUSES)[number];

/** Live access to one builder-owned repository already connected as a Project. */
const GitHubRepositoryAccess = wire({
  projectId: num(),
  githubRepo: text(),
  platform: text(),
  status: oneOf(ACCESS_STATUSES, "error"),
  settingsUrl: maybeText,
});
export type GitHubRepositoryAccess = z.output<typeof GitHubRepositoryAccess>;

export const GitHubAppInstallationsResult = wire({
  status: oneOf(["ok", "action_required", "error"], "error"),
  repositories: list(GitHubRepositoryAccess),
});
export type GitHubAppInstallationsResult = z.output<typeof GitHubAppInstallationsResult>;

/**
 * The key a builder shares so others can use a private application in Chat. Anyone holding it
 * can use the application, so it is a secret; regenerating it revokes the previous one. A
 * response without a key reads null.
 */
export const BuilderAppKey = maybe(
  wire({ key: text(), keyPrefix: maybeText, applicationId: num(0), createdAt: num(0), lastUsedAt: maybeNum }),
).transform((row) => (row?.key ? { ...row, keyPrefix: row.keyPrefix ?? row.key.slice(0, 8) } : null));
export type BuilderAppKey = NonNullable<z.output<typeof BuilderAppKey>>;

export const GitHubIdentity = wire({
  githubUserId: text(),
  githubLogin: text(),
  /** The most recent installation of the exchanged App this user can see, if any. */
  installationId: maybeText,
  /** Opaque manager-signed, 10-minute installation visibility snapshot. */
  visibilityGrant: maybeText,
});
export type GitHubIdentity = z.output<typeof GitHubIdentity>;

export const ClaimGitHubProjectResult = wire({ githubUserId: text(), project: UserProject });
export type ClaimGitHubProjectResult = z.output<typeof ClaimGitHubProjectResult>;

/** A secret slot declared in an app release manifest. */
export const SecretSlot = z.object({
  name: z.string(),
  description: z.string(),
  required: z.boolean(),
  /** The chat user supplies this value. Absent and false are Builder-owned. */
  user_own: z.literal(true).optional().catch(undefined),
});
export type SecretSlot = z.output<typeof SecretSlot>;

/** Well-formed slots only; a malformed one is dropped. */
const slots = z.unknown().transform((value) =>
  (Array.isArray(value) ? value : []).flatMap((slot) => {
    const parsed = SecretSlot.safeParse(slot);
    if (!parsed.success) return [];
    const { user_own, ...rest } = parsed.data;
    return [user_own ? { ...rest, user_own } : rest];
  }),
);

export const UserProjectRequiredSecretsResult = wire({
  byApp: dict(wire({ applicationId: num(), slots })),
});
export type UserProjectRequiredSecretsResult = z.output<typeof UserProjectRequiredSecretsResult>;

const sdkUpgradeCommon = { requiredSdkVersion: text(), sourceRef: text() };

export const ProjectSdkUpgradeResult = strict(
  z.union([
    wire({ status: z.literal("current"), ...sdkUpgradeCommon }),
    wire({
      status: z.literal("pull_request"),
      ...sdkUpgradeCommon,
      branch: text(),
      files: list(z.unknown().transform(String)),
      pullRequest: wire({ number: num(), url: text(), created: flag }),
    }),
    wire({
      status: z.literal("manual"),
      ...sdkUpgradeCommon,
      reason: text("SDK upgrade requires a local change."),
      command: text(),
    }),
  ]),
  "backend returned an unknown source SDK upgrade status",
);
export type ProjectSdkUpgradeResult = z.output<typeof ProjectSdkUpgradeResult>;

/**
 * The cheap merge poll for the upgrade PR an earlier upgrade opened. `merged` is terminal
 * (redeploy from the merged default branch), `open` means keep polling, and `closed`/`none`
 * mean the PR is gone, so run the upgrade again.
 */
export const ProjectSdkUpgradeStatusResult = strict(
  wire({
    status: z.enum(["merged", "open", "closed", "none"]),
    requiredSdkVersion: text(),
    branch: text(),
    pullRequest: maybe(wire({ number: num(), url: text(), state: text(), merged: flag })),
  }),
  "backend returned an unknown source SDK upgrade status",
);
export type ProjectSdkUpgradeStatusResult = z.output<typeof ProjectSdkUpgradeStatusResult>;
