/**
 * Response-side wire mappers (snake_case wire -> camelCase domain types)
 * for the deploy, bootstrap, and user-project surfaces. Operate-surface
 * mappers live in operate.ts.
 */
import { DeployError } from "../errors";
import type {
  ActivateResult,
  BotRegistration,
  BuilderModelKey,
  BuilderModelKeyUsage,
  DeployResult,
  DeploymentStatus,
  PlatformApp,
  Project,
  TokenRecord,
  UserDeployment,
  UserDeploymentsPage,
  UserProject,
} from "../types";

export function camelDeployResult(result: unknown): DeployResult {
  const raw = result as Record<string, any>;
  const deployment = raw.deployment ?? {};
  const source = deployment.source ?? {};
  const platform = deployment.platform ?? {};
  return {
    ok: raw.ok === true,
    deployment: {
      id: deployment.id,
      status: deployment.status,
      sdkVersion: deployment.sdk_version ?? deployment.sdkVersion ?? null,
      source: {
        installationId: source.installation_id,
        repositoryId: source.repository_id,
        repositoryLink: source.repository_link,
        ref: source.ref,
        commitHash: source.commit_hash,
      },
      platform: {
        platform: platform.platform,
        repository: platform.repository,
        deployBranch: platform.deploy_branch,
        platformBranch: platform.platform_branch,
        commitHash: platform.commit_hash ?? null,
        prNumber: platform.pr_number ?? null,
        prUrl: platform.pr_url ?? null,
        ciStatus: platform.ci_status ?? null,
        ciUrl: platform.ci_url ?? null,
        apps: (platform.apps ?? []).map((app: Record<string, any>) => ({
          name: app.name,
          path: app.path,
          aomiTomlPath: app.aomi_toml_path,
          releaseTag: app.release_tag,
          sdkVersion: app.sdk_version ?? app.sdkVersion ?? null,
          target: app.target ?? null,
          files: (app.files ?? []).map((file: Record<string, any>) => ({
            path: file.path,
            sha256: file.sha256,
            bytes: Number(file.bytes ?? 0),
          })),
        })),
      },
    },
  };
}

export function camelActivateResult(result: unknown): ActivateResult {
  const raw = result as Record<string, any>;
  const activation = raw.activation ?? {};
  const target = activation.target ?? {};
  return {
    ok: Boolean(raw.ok),
    activation: {
      status: activation.status,
      platform: activation.platform,
      target: {
        kind: target.kind,
        value: target.value,
        platformRepo: target.platform_repo ?? null,
        platformBranch: target.platform_branch ?? null,
        platformCommitHash: target.platform_commit_hash ?? null,
        ciStatus: target.ci_status ?? null,
        ciUrl: target.ci_url ?? null,
        promoted: (target.promoted ?? []).map(
          (promotion: Record<string, any>) => ({
            name: promotion.name,
            releaseTag: promotion.release_tag,
            platformBranch: promotion.platform_branch,
            platformCommitHash:
              promotion.platform_commit_hash ??
              promotion.activated_commit_hash ??
              null,
            liveCommitHash: promotion.live_commit_hash ?? null,
            activationStatus: promotion.activation_status ?? null,
            ciStatus: promotion.ci_status,
            ciUrl: promotion.ci_url ?? null,
            releaseAssets: promotion.release_assets ?? [],
            releaseAssetDigests: promotion.release_asset_digests ?? {},
          }),
        ),
      },
      apps: (activation.apps ?? []).map((app: Record<string, any>) => ({
        applicationId: app.application_id ?? app.applicationId ?? null,
        name: app.name,
        path: app.path ?? null,
        releaseTag: app.release_tag ?? null,
        isActive: Boolean(app.is_active),
        artifactReady: Boolean(app.artifact_ready ?? app.artifactReady),
        loaded: Boolean(app.loaded),
        error: app.error ?? null,
        platformBranch: app.platform_branch ?? null,
        liveCommitHash: app.live_commit_hash ?? null,
        activationStatus: app.activation_status ?? null,
        activationPr: app.activation_pr ?? app.activationPr ?? null,
        activationPrCloseError:
          app.activation_pr_close_error ?? app.activationPrCloseError ?? null,
      })),
    },
  };
}

export function camelStatusResult(
  raw: Record<string, unknown>,
): DeploymentStatus {
  const apps = (raw.apps ?? []) as Record<string, unknown>[];
  return {
    state: raw.state as DeploymentStatus["state"],
    deployment: raw.deployment
      ? camelDeployResult({ deployment: raw.deployment }).deployment
      : undefined,
    releaseTags: (raw.release_tags ?? raw.releaseTags ?? []) as string[],
    apps: apps.length
      ? apps.map((app: Record<string, unknown>) => ({
          name: app.name as string,
          releaseTag: (app.release_tag ?? app.releaseTag) as string,
          releaseReady: Boolean(app.release_ready ?? app.releaseReady),
          releaseAssets: (app.release_assets ??
            app.releaseAssets ??
            []) as string[],
          releaseAssetDigests: (app.release_asset_digests ??
            app.releaseAssetDigests ??
            {}) as Record<string, string>,
          message: (app.message ?? null) as string | null,
        }))
      : undefined,
    ci: raw.ci
      ? {
          status: (raw.ci as Record<string, unknown>).status as
            | string
            | undefined,
          url: (raw.ci as Record<string, unknown>).url as string | undefined,
          commitHash: ((raw.ci as Record<string, unknown>).commit_hash ??
            (raw.ci as Record<string, unknown>).commitHash) as
            | string
            | undefined,
        }
      : undefined,
    message: raw.message as string | undefined,
  };
}

export function camelProject(raw: unknown): Project {
  const project = (raw ?? {}) as Record<string, any>;
  return {
    id: Number(project.id),
    installationId: Number(project.installation_id),
    repositoryId: Number(project.repository_id),
    repositoryLink: String(project.repository_link ?? ""),
    platformId: Number(project.platform_id),
    ownerBuilderId: Number(project.owner_builder_id),
    createdAt: Number(project.created_at),
    updatedAt: Number(project.updated_at),
  };
}

export function camelTokenRecord(raw: unknown): TokenRecord {
  const t = (raw ?? {}) as Record<string, any>;
  return {
    id: Number(t.id),
    scope: t.scope ?? null,
    appId: t.app_id ?? null,
    tokenHashPrefix: t.token_hash_prefix ?? "",
    createdAt: t.created_at ?? null,
    lastUsedAt: t.last_used_at ?? null,
    revokedAt: t.revoked_at ?? null,
    appsUsage: t.apps_usage ?? null,
    platformUsage: t.platform_usage ?? null,
  };
}

export function camelPlatformApp(raw: unknown): PlatformApp {
  const a = (raw ?? {}) as Record<string, any>;
  return {
    id: Number(a.id),
    name: a.name,
    label: a.label ?? null,
    platform: a.platform ?? null,
    isActive: Boolean(a.is_active),
    isPublic: Boolean(a.is_public),
    projectId: a.project_id ?? null,
    appReleaseTag: a.app_release_tag ?? null,
    targetTags: a.target_tags ?? [],
    artifactReady: Boolean(a.artifact_ready ?? a.artifactReady),
    loaded: Boolean(a.loaded),
    pricing: camelAppPricing(a.pricing),
  };
}

export function camelAppPricing(raw: unknown): PlatformApp["pricing"] {
  if (!raw || typeof raw !== "object") return null;
  const pricing = raw as Record<string, any>;
  const config = (pricing.config ?? {}) as Record<string, any>;
  const resources = (config.resources ?? {}) as Record<
    string,
    Record<string, any>
  >;
  return {
    loadedAt: timestampSeconds(pricing.loaded_at ?? pricing.loadedAt),
    config: {
      version: Number(config.version ?? 0),
      beneficiaries: (
        (config.beneficiaries ?? []) as Record<string, any>[]
      ).map((beneficiary) => ({
        name: String(beneficiary.name ?? ""),
        type: String(beneficiary.type ?? ""),
        chain: String(beneficiary.chain ?? ""),
        value: String(beneficiary.value ?? ""),
      })),
      resources: Object.fromEntries(
        Object.entries(resources).map(([tool, resource]) => [
          tool,
          {
            pricing: {
              flat: Number(resource.pricing?.flat ?? 0),
            },
            beneficiary: resource.beneficiary ?? null,
          },
        ]),
      ),
      outcome: Array.isArray(config.outcome) ? config.outcome : [],
    },
  };
}

export function camelBotRegistration(raw: unknown): BotRegistration {
  const b = (raw ?? {}) as Record<string, any>;
  return {
    id: String(b.id),
    platform: String(b.platform ?? ""),
    status: String(b.status ?? ""),
    label: b.label ?? null,
    handoverApp: String(b.handover_app ?? b.handoverApp ?? ""),
    handoverAppId: Number(b.handover_app_id ?? b.handoverAppId ?? 0),
    miniAppUrl: b.mini_app_url ?? b.miniAppUrl ?? null,
    commandEndpoint: b.command_endpoint ?? b.commandEndpoint ?? null,
    commands: Array.isArray(b.commands)
      ? b.commands.filter(
          (command: unknown): command is string => typeof command === "string",
        )
      : [],
    apps: ((b.apps ?? []) as Record<string, any>[]).map((app) => ({
      applicationId: Number(app.application_id ?? app.applicationId ?? 0),
      projectId: app.project_id ?? app.projectId ?? null,
      projectLabel: app.project_label ?? app.projectLabel ?? null,
      name: String(app.name ?? ""),
      label: String(app.label ?? app.name ?? ""),
      platform: app.platform ?? null,
      isPrimary: Boolean(app.is_primary ?? app.isPrimary),
    })),
    platformBotId: String(b.platform_bot_id ?? b.platformBotId ?? ""),
    platformUsername: b.platform_username ?? b.platformUsername ?? null,
    webhookUrl: b.webhook_url ?? b.webhookUrl ?? null,
    threadMode: String(b.thread_mode ?? b.threadMode ?? "single"),
    configurationVersion: Number(
      b.configuration_version ?? b.configurationVersion ?? 0,
    ),
    createdAt: Number(b.created_at ?? b.createdAt ?? 0),
  };
}

function camelModelKeyUsage(raw: unknown): BuilderModelKeyUsage {
  const u = (raw ?? {}) as Record<string, any>;
  return {
    inputTokens: Number(u.inputTokens ?? 0),
    outputTokens: Number(u.outputTokens ?? 0),
    costCredits: Number(u.costCredits ?? 0),
    turns: Number(u.turns ?? 0),
  };
}

export function camelBuilderModelKey(raw: unknown): BuilderModelKey {
  const k = (raw ?? {}) as Record<string, any>;
  return {
    id: Number(k.id),
    provider: String(k.provider ?? ""),
    label: k.label ?? null,
    keyPrefix: String(k.keyPrefix ?? k.key_prefix ?? ""),
    createdAt: Number(k.createdAt ?? k.created_at ?? 0),
    updatedAt: Number(k.updatedAt ?? k.updated_at ?? 0),
    applicationIds: Array.isArray(k.applicationIds ?? k.application_ids)
      ? (k.applicationIds ?? k.application_ids).map(Number)
      : [],
    usage: camelModelKeyUsage(k.usage),
    usageByApplication: Array.isArray(k.usageByApplication)
      ? k.usageByApplication.map((row: unknown) => ({
          applicationId: Number((row as Record<string, any>)?.applicationId),
          ...camelModelKeyUsage(row),
        }))
      : [],
  };
}

export function timestampSeconds(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 100_000_000_000 ? Math.floor(value / 1000) : value;
  }
  if (typeof value !== "string") return 0;
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) {
    return numeric > 100_000_000_000 ? Math.floor(numeric / 1000) : numeric;
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

export function camelUserProjectLatestDeployment(
  raw: unknown,
): UserProject["latestDeployment"] {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, any>;
  const apps = (d.apps ?? []) as Record<string, any>[];
  const createdAt = d.created_at;
  if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) {
    throw new DeployError(
      "BACKEND",
      "backend deployment response is missing created_at",
    );
  }
  return {
    deploymentId: d.deployment_id ?? d.deploymentId ?? d.id ?? null,
    state: d.state ?? d.status ?? null,
    platformBranch: d.platform_branch ?? d.platformBranch ?? null,
    platformRepo: d.platform_repo ?? d.platformRepo ?? d.repository ?? null,
    commitHash: d.commit_hash ?? d.commitHash ?? null,
    ciStatus: d.ci_status ?? d.ciStatus ?? d.ci?.status ?? null,
    ciUrl: d.ci_url ?? d.ciUrl ?? d.ci?.url ?? null,
    ciRunId: d.ci_run_id ?? d.ciRunId ?? null,
    releaseTags: (d.release_tags ?? d.releaseTags ?? []) as string[],
    sdkVersion: d.sdk_version ?? d.sdkVersion ?? null,
    artifactTarget: d.artifact_target ?? d.artifactTarget ?? null,
    buildTarget: d.build_target ?? d.buildTarget ?? d.target ?? null,
    createdAt,
    apps: apps.map((app) => ({
      name: app.name,
      releaseTag: app.release_tag ?? app.releaseTag ?? null,
      sdkVersion: app.sdk_version ?? app.sdkVersion ?? null,
      target: app.target ?? null,
      applicationId: app.application_id ?? app.applicationId ?? null,
      projectId: app.project_id ?? app.projectId ?? null,
      appReleaseTag: app.app_release_tag ?? app.appReleaseTag ?? null,
      isActive: Boolean(app.is_active ?? app.isActive),
      artifactReady: Boolean(app.artifact_ready ?? app.artifactReady),
      loaded: Boolean(app.loaded),
    })),
  };
}

export function camelUserDeployment(raw: unknown): UserDeployment | null {
  if (!raw || typeof raw !== "object") return null;
  const deployment = camelUserProjectLatestDeployment(raw);
  if (!deployment) return null;
  const value = raw as Record<string, any>;
  const projectId = Number(value.project_id ?? value.projectId);
  if (!Number.isSafeInteger(projectId) || projectId <= 0) return null;
  return {
    ...deployment,
    projectId,
    repositoryLink: String(value.repository_link ?? value.repositoryLink ?? ""),
  };
}

export function camelUserDeploymentsCursor(
  raw: unknown,
): UserDeploymentsPage["nextCursor"] {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, any>;
  const createdAt = Number(value.created_at ?? value.createdAt);
  const id = Number(value.id);
  if (!Number.isSafeInteger(createdAt) || !Number.isSafeInteger(id)) {
    return null;
  }
  return { createdAt, id };
}

export function camelUserProject(raw: unknown): UserProject {
  const project = (raw ?? {}) as Record<string, any>;
  const platformName = project.platform_name;
  if (typeof platformName !== "string" || !platformName.trim()) {
    throw new DeployError(
      "BACKEND",
      "backend Project response is missing its platform binding",
    );
  }
  const configuration = project.configuration as
    | Record<string, any>
    | null
    | undefined;
  return {
    ...camelProject(project),
    platformName: platformName.trim(),
    apps: ((project.apps ?? []) as unknown[]).map(camelPlatformApp),
    configuration:
      configuration?.status === "valid"
        ? {
            status: "valid",
            revision: String(configuration.revision ?? ""),
            configHash: String(
              configuration.config_hash ?? configuration.configHash ?? "",
            ),
            applications: (
              (configuration.applications ?? []) as Record<string, any>[]
            ).map((app) => ({
              path: String(app.path ?? ""),
              name: String(app.name ?? ""),
              sdkVersion: app.sdk_version ?? app.sdkVersion ?? null,
              target: String(app.target ?? ""),
            })),
          }
        : configuration?.status === "invalid"
          ? {
              status: "invalid",
              checkedRevision: String(
                configuration.checked_revision ??
                  configuration.checkedRevision ??
                  "",
              ),
              reason: configuration.reason,
              lastValidRevision:
                configuration.last_valid_revision ??
                configuration.lastValidRevision ??
                null,
            }
          : undefined,
    latestDeployment: camelUserProjectLatestDeployment(
      project.latest_deployment ?? project.latestDeployment,
    ),
    sdkVersion: project.sdk_version ?? project.sdkVersion ?? null,
    sdkVersions: (
      (project.sdk_versions ?? project.sdkVersions ?? []) as unknown[]
    ).flatMap((version) =>
      typeof version === "string" && version ? [version] : [],
    ),
  };
}

export function responseRecord(
  value: unknown,
  field: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DeployError("BACKEND", `backend response is missing ${field}`);
  }
  return value as Record<string, unknown>;
}
