import type { ManagerClient } from "../client";
import { BackendError } from "@aomi-labs/deploy";
import type { ReleaseManifest, SecretSlot, UserProject } from "@aomi-labs/deploy";
import { missingRequiredSecrets } from "@aomi-labs/deploy";

const GITHUB_API = "https://api.github.com";

type ReleaseAsset = { name: string; url: string };

export const REQUIRED_SECRETS_CHECK_UNAVAILABLE =
  "REQUIRED_SECRETS_CHECK_UNAVAILABLE" as const;

/**
 * Why the check could not answer. All of these close the gate, but they are
 * not the same problem and the builder can only act on one of them:
 *
 * - `bff_misconfigured` — this deployment has no `GITHUB_TOKEN`. Retrying can
 *   never fix it; it needs an operator. Telling a builder to "try again" here
 *   is the wrong instruction, which is why it is not folded in with the rest.
 * - `github_unavailable` / `backend_unavailable` — transient upstream; retry
 *   is the right advice.
 * - `unresolvable_project` — no platform repo for the project yet.
 */
export type RequiredSecretsCheckReason =
  | "bff_misconfigured"
  | "github_unavailable"
  | "backend_unavailable"
  | "unresolvable_project";

/** The required-secret metadata could not be verified safely. */
export class RequiredSecretsCheckError extends Error {
  readonly code = REQUIRED_SECRETS_CHECK_UNAVAILABLE;
  readonly reason: RequiredSecretsCheckReason;
  readonly retryable: boolean;
  readonly upstream?: "github" | "rust";
  readonly upstreamStatus?: number;

  constructor(options?: {
    cause?: unknown;
    reason?: RequiredSecretsCheckReason;
    upstream?: "github" | "rust";
    upstreamStatus?: number;
  }) {
    const reason = options?.reason ?? "github_unavailable";
    super(
      reason === "bff_misconfigured"
        ? "Required secrets cannot be verified: this deployment is missing its GitHub token."
        : "Unable to verify required secrets. Try again.",
      { cause: options?.cause },
    );
    this.name = "RequiredSecretsCheckError";
    this.reason = reason;
    this.retryable = reason !== "bff_misconfigured";
    this.upstream = options?.upstream;
    this.upstreamStatus = options?.upstreamStatus;
  }
}

/**
 * Read the declared secret slots out of a release's `manifest.json` asset.
 *
 * Returns `{}` for a release that predates `aomi-build compile` writing the
 * slots, so activation of an older release is never blocked by their absence.
 * Lookup failures throw instead: treating an unreadable manifest as an old
 * release would silently bypass required-secret gating.
 */
export async function fetchReleaseSecretSlots(input: {
  platformRepo: string;
  releaseTag: string;
  githubToken: string;
  fetchImpl?: typeof fetch;
}): Promise<Record<string, SecretSlot[]>> {
  const doFetch = input.fetchImpl ?? fetch;
  const headers = {
    authorization: `Bearer ${input.githubToken}`,
    "x-github-api-version": "2022-11-28",
  };

  try {
    const releaseUrl = `${GITHUB_API}/repos/${input.platformRepo}/releases/tags/${encodeURIComponent(input.releaseTag)}`;
    const releaseRes = await doFetch(releaseUrl, {
      headers: { ...headers, accept: "application/vnd.github+json" },
    });
    if (!releaseRes.ok) {
      throw new RequiredSecretsCheckError({
        reason: "github_unavailable",
        upstream: "github",
        upstreamStatus: releaseRes.status,
      });
    }

    const release = (await releaseRes.json()) as { assets?: ReleaseAsset[] };
    const asset = release.assets?.find((a) => a.name === "manifest.json");
    if (!asset) return {};

    // The asset `url` (not browser_download_url) honours the bearer token, so
    // this works for private platform repos too.
    const assetRes = await doFetch(asset.url, {
      headers: { ...headers, accept: "application/octet-stream" },
    });
    if (!assetRes.ok) {
      throw new RequiredSecretsCheckError({
        reason: "github_unavailable",
        upstream: "github",
        upstreamStatus: assetRes.status,
      });
    }

    const manifest = (await assetRes.json()) as ReleaseManifest;
    const slots: Record<string, SecretSlot[]> = {};
    for (const [app, plugin] of Object.entries(manifest.plugins ?? {})) {
      slots[app] = plugin.secrets ?? [];
    }
    return slots;
  } catch (error) {
    if (error instanceof RequiredSecretsCheckError) throw error;
    throw new RequiredSecretsCheckError({
      cause: error,
      reason: "github_unavailable",
      upstream: "github",
    });
  }
}

/**
 * Manifest reads in flight at once. This gate runs on the activate/promote
 * write path, where GitHub is authoritative — the DB-backed console read only
 * reports declarations already snapshotted by a previous activation, so it
 * cannot stand in for this check on a release being activated for the first
 * time. Bounded so a many-app project cannot burst the shared token's rate
 * limit, wide enough that a typical project is a single wave.
 */
const MANIFEST_CONCURRENCY = 4;

/** Resolve `task` over `items` with at most `limit` in flight. Rejections
 *  propagate: an unreadable manifest must fail the gate, not skip an app. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await task(items[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker),
  );
  return results;
}

/**
 * Required slots the apps declare (from each release's manifest.json) that have
 * no value in the vault yet, keyed by app name. Empty object = no missing
 * required values. Verification failures throw so activation cannot proceed
 * when the manifest is unreadable.
 *
 * A manifest covers every app in its release, so the lookup is keyed by
 * release tag, not by app: apps activated together normally share one tag and
 * therefore one fetch. Awaiting them one pair at a time put every app's GitHub
 * latency end-to-end in front of the user's Activate click.
 *
 * `input.project` normally comes from `listUserProjects`, and the backend
 * deliberately returns `latest_deployment: null` on that list endpoint (it's
 * lazy there). So `input.project.latestDeployment?.platformRepo` is checked
 * first as a cheap path (in case a caller ever passes an already-populated
 * project), but the real value comes from the per-project latest-deployment
 * detail endpoint, which does populate `platformRepo`. `platformRepo` is a
 * platform-level constant across a project's deployments, so the latest
 * deployment's value is correct for any release tag being gated here.
 */
export async function missingSecretsForActivation(input: {
  client: Pick<ManagerClient, "getUserProjectLatestDeployment" | "listAppSecrets">;
  githubUserId: string;
  project: UserProject;
  pairs: { app: string; releaseTag: string }[];
  githubToken?: string;
}): Promise<Record<string, string[]>> {
  if (input.pairs.length === 0) return {};

  // The Node BFF may fall back to its environment; the edge Worker has no
  // `process` and always passes the token in.
  const githubToken =
    input.githubToken ??
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
      ?.GITHUB_TOKEN?.trim();
  if (!githubToken) {
    throw new RequiredSecretsCheckError({ reason: "bff_misconfigured" });
  }

  let platformRepo = input.project.latestDeployment?.platformRepo ?? undefined;
  if (!platformRepo) {
    try {
      const latest = await input.client.getUserProjectLatestDeployment({
        githubUserId: input.githubUserId,
        projectId: input.project.id,
      });
      platformRepo = latest?.platformRepo ?? undefined;
    } catch (error) {
      throw new RequiredSecretsCheckError({
        cause: error,
        reason: "backend_unavailable",
        upstream: "rust",
        upstreamStatus:
          error instanceof BackendError ? error.status : undefined,
      });
    }
  }
  if (!platformRepo) {
    throw new RequiredSecretsCheckError({ reason: "unresolvable_project" });
  }
  const repo = platformRepo;

  // Kept after the platform-repo resolution on purpose: when that fails the
  // gate is already closed, and this read must not fire anyway.
  const configured = Object.fromEntries(
    await mapWithConcurrency(input.pairs, MANIFEST_CONCURRENCY, async (pair) => {
      const application = input.project.apps.find((app) => app.name === pair.app);
      if (!application) {
        throw new RequiredSecretsCheckError({
          cause: new Error(`Application identity is unavailable for ${pair.app}`),
          reason: "backend_unavailable",
          upstream: "rust",
        });
      }
      const result = await input.client.listAppSecrets({
        applicationId: application.id,
      });
      return [pair.app, result.byApp[pair.app] ?? []] as const;
    }),
  );

  const releaseTags = [...new Set(input.pairs.map((pair) => pair.releaseTag))];
  const manifests = await mapWithConcurrency(
    releaseTags,
    MANIFEST_CONCURRENCY,
    (releaseTag) =>
      fetchReleaseSecretSlots({ platformRepo: repo, releaseTag, githubToken }),
  );
  const slotsByTag = new Map(
    releaseTags.map((releaseTag, index) => [releaseTag, manifests[index]]),
  );

  const missing: Record<string, string[]> = {};
  for (const pair of input.pairs) {
    const slots = slotsByTag.get(pair.releaseTag) ?? {};
    const configuredKeys = (configured[pair.app] ?? []).map(
      (handle) => handle.split("::").pop() ?? handle,
    );
    const unfilled = missingRequiredSecrets(slots[pair.app], configuredKeys);
    if (unfilled.length > 0) {
      missing[pair.app] = unfilled.map((slot) => slot.name);
    }
  }
  return missing;
}
