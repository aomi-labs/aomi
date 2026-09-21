import type {
  AomiAppDescriptor,
  AomiArtifactStatus,
  AomiFeatureCategory,
  AomiSecretSlot,
} from "./types";

const ARTIFACT_STATUSES = new Set<AomiArtifactStatus>([
  "ready",
  "pending",
  "fetch_backoff",
]);
const FEATURE_CATEGORIES = new Set<AomiFeatureCategory>([
  "lending",
  "cross-chain",
  "staking",
  "trading",
  "research",
  "wallets",
  "developer",
]);

function normalizeSecretSlot(item: unknown): AomiSecretSlot | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const raw = item as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return null;
  return {
    name,
    description:
      typeof raw.description === "string" ? raw.description.trim() : "",
    required: raw.required === true,
    user_own: raw.user_own === true || raw.userOwn === true,
  };
}

/**
 * Canonical home for app-descriptor identity logic. The backend speaks
 * snake_case and may scope a single app `name` across multiple platforms, so
 * both normalization (wire shape → descriptor) and identity (descriptor →
 * stable key) live here to keep every consumer — client, React control state,
 * UI selectors, and any future server/BFF code — in lockstep.
 */

/**
 * Coerce an arbitrary wire item (string id, camelCase object, or snake_case
 * object) into a single camelCase {@link AomiAppDescriptor}. Returns null for
 * anything without a usable `name`.
 */
export function normalizeAppDescriptor(
  item: unknown,
): AomiAppDescriptor | null {
  if (typeof item === "string") {
    const name = item.trim();
    return name ? { name } : null;
  }
  if (!item || typeof item !== "object") return null;

  const raw = item as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return null;

  const descriptor: AomiAppDescriptor = {
    ...raw,
    name,
  } as AomiAppDescriptor;
  const applicationId = raw.applicationId ?? raw.application_id ?? raw.id;
  if (typeof applicationId === "number" || typeof applicationId === "string") {
    descriptor.applicationId = applicationId;
  }
  if (typeof raw.platform === "string") descriptor.platform = raw.platform;
  if (typeof raw.label === "string") descriptor.label = raw.label;
  if (
    raw.metadata &&
    typeof raw.metadata === "object" &&
    !Array.isArray(raw.metadata)
  ) {
    descriptor.metadata = raw.metadata as Record<string, unknown>;
  }
  const featureCatalog = raw.featureCatalog ?? raw.feature_catalog;
  descriptor.featureCatalog = Array.isArray(featureCatalog)
    ? [
        ...new Set(
          featureCatalog.filter(
            (feature): feature is AomiFeatureCategory =>
              typeof feature === "string" &&
              FEATURE_CATEGORIES.has(feature as AomiFeatureCategory),
          ),
        ),
      ]
    : [];
  if (typeof raw.appReleaseTag === "string") {
    descriptor.appReleaseTag = raw.appReleaseTag;
  } else if (typeof raw.app_release_tag === "string") {
    descriptor.appReleaseTag = raw.app_release_tag;
  }
  if (typeof raw.isActive === "boolean") {
    descriptor.isActive = raw.isActive;
  } else if (typeof raw.is_active === "boolean") {
    descriptor.isActive = raw.is_active;
  }
  if (typeof raw.isPublic === "boolean") {
    descriptor.isPublic = raw.isPublic;
  } else if (typeof raw.is_public === "boolean") {
    descriptor.isPublic = raw.is_public;
  }
  if (typeof raw.artifactReady === "boolean") {
    descriptor.artifactReady = raw.artifactReady;
  } else if (typeof raw.artifact_ready === "boolean") {
    descriptor.artifactReady = raw.artifact_ready;
  }
  const artifactStatus = raw.artifactStatus ?? raw.artifact_status;
  if (
    typeof artifactStatus === "string" &&
    ARTIFACT_STATUSES.has(artifactStatus as AomiArtifactStatus)
  ) {
    descriptor.artifactStatus = artifactStatus as AomiArtifactStatus;
  }
  descriptor.secrets = Array.isArray(raw.secrets)
    ? raw.secrets
        .map(normalizeSecretSlot)
        .filter((slot): slot is AomiSecretSlot => slot !== null)
    : [];
  const rawChainIds = raw.chainIds ?? raw.chain_ids;
  if (Array.isArray(rawChainIds)) {
    descriptor.chainIds = [
      ...new Set(
        rawChainIds.filter(
          (chainId): chainId is number =>
            typeof chainId === "number" &&
            Number.isSafeInteger(chainId) &&
            chainId > 0,
        ),
      ),
    ].sort((left, right) => left - right);
  }
  // Drop the source twins carried over by the spread so the descriptor exposes
  // a single camelCase identity (no `id`/`application_id`/`applicationId`
  // triplets downstream).
  for (const key of [
    "id",
    "application_id",
    "app_release_tag",
    "is_active",
    "is_public",
    "artifact_ready",
    "artifact_status",
    "chain_ids",
    "feature_catalog",
  ]) {
    delete (descriptor as unknown as Record<string, unknown>)[key];
  }
  return descriptor;
}

/** Registration is backend-controlled; neither public visibility nor a repo
 * URL implies official ownership. Bare app names are code-owned builtins. */
export function isOfficialAppDescriptor(app: AomiAppDescriptor): boolean {
  const source = app.metadata?.source;
  const registeredVia = app.metadata?.registered_via;
  return (
    source === "builtin" ||
    registeredVia === "official_source" ||
    (app.applicationId == null && !app.platform && registeredVia == null)
  );
}

/**
 * Stable key identifying an app for dedup and selection-matching. Prefers the
 * concrete backend `applicationId`, falls back to `platform:name`, then `name`.
 * Server-side dedup and client-side selection must agree, so both call this.
 */
export function appIdentityKey(descriptor: AomiAppDescriptor): string {
  const applicationId = descriptor.applicationId?.toString().trim();
  if (applicationId) return `application:${applicationId}`;
  const platform = descriptor.platform?.trim();
  if (platform) return `platform:${platform}:${descriptor.name}`;
  return `name:${descriptor.name}`;
}
