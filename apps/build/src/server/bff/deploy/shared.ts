import "@tanstack/react-start/server-only";

import { ownedProject } from "@aomi-labs/deploy/bff";
import { backendClient } from "@/server/bff/backend";
import { TimedPromiseCache } from "@/server/bff/timed-promise-cache";

// Server-side timing for the manager reads on the project page's critical
// path. Read these off a staging load to tell a heavy manager query from a
// fat payload or pool contention — they want different fixes.
export async function timedManagerRead<T>(
  label: string,
  run: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await run();
  } finally {
    console.info(
      `deploy bff: ${label} took ${Math.round(performance.now() - startedAt)}ms`,
    );
  }
}

type BackendClientInstance = Awaited<ReturnType<typeof backendClient>>;

export function deployErrorContext(req: Request, operation: string) {
  return {
    routeFamily: new URL(req.url).pathname,
    operation,
    method: req.method,
  };
}

type OwnedProject = Awaited<
  ReturnType<BackendClientInstance["listUserProjects"]>
>[number];

/** The signed-in user's projects. Ownership checks always read the
 *  account-wide list (platform undefined) so partner-bound projects are never
 *  invisible; an explicit platform is only a Projects-page narrowing filter. */
function cachedUserProjects(
  client: BackendClientInstance,
  githubUserId: string,
  platform?: string,
): Promise<OwnedProject[]> {
  return readCache.projects.get([githubUserId, platform ?? null], () =>
    client.listUserProjects({ githubUserId, platform }),
  );
}

/** The platform every downstream platform-addressed call must use once a
 *  project is known: the project's required bound platform. */
export function projectPlatform(project: OwnedProject): string {
  const platform = project.platformName.trim();
  if (!platform) throw new Error("project is missing its bound platform");
  return platform;
}

// Read cache for the hot project-page GETs. Same 15s TTL as operate's, and it
// coalesces concurrent mounts onto one manager call — but unlike operate's
// read-only routes, deploy mutations CHANGE what these reads return (preflight
// re-syncs the source and can register apps; activate/promote/deactivate move
// the live release), so every source-mutating route clears it. Without that,
// the redeploy flow's `reload()` after preflight would read a stale list and
// the required-secrets gate could fail for an app the UI has no row for.
const READ_CACHE_TTL_MS = 15_000;

export const readCache = {
  projects: new TimedPromiseCache<OwnedProject[]>(READ_CACHE_TTL_MS),
  projectDetails: new TimedPromiseCache<OwnedProject>(READ_CACHE_TTL_MS),
  serverTags: new TimedPromiseCache<
    Awaited<ReturnType<BackendClientInstance["serverTags"]>>
  >(READ_CACHE_TTL_MS),
};

export function clearDeployReadCache() {
  Object.values(readCache).forEach((cache) => cache.clear());
}

/** The signed-in user's project with `projectId`, or null if not theirs.
 *  Account-wide: the backend scopes listUserProjects to the session's GitHub
 *  user id, so an id absent from the result is not owned by the caller. */
export async function findOwnedProject(
  client: BackendClientInstance,
  githubUserId: string,
  projectId: number,
): Promise<OwnedProject | null> {
  return ownedProject(
    (input) => cachedUserProjects(client, input.githubUserId),
    githubUserId,
    projectId,
  );
}

export function isValidProjectId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function isValidApplicationId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function invalidPlatformResponse(): Response {
  return Response.json(
    { error: "unknown or unavailable `platform`" },
    { status: 400 },
  );
}
