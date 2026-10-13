import "@tanstack/react-start/server-only";

import type { FailureInput } from "@aomi-labs/observability";
import type {
  OperateLogsResult,
  OperateAppDetailResult,
  OperateObservabilityResult,
  OperateObservabilitySnapshot,
  OperatePaymentProjectResult,
  OperateStatementResult,
  OperateTransactionsResult,
  OperateUsageResult,
  UserLogsResult,
  UserProject,
  UserProjectLatestDeployment,
  UserTransactionsResult,
} from "@aomi-labs/deploy";
import { backendClient } from "@/server/bff/backend";
import { authorize } from "@/server/bff/auth";
import { resolveDeployPlatform } from "@/server/bff/deploy/config";
import { deployConfig } from "@/server/env";
import { buildFailures } from "@/server/bff/failures";
import { TimedPromiseCache } from "@/server/bff/timed-promise-cache";

type BackendClientInstance = Awaited<ReturnType<typeof backendClient>>;

export function identifyOperateFailure(
  req: Request,
  operation: string,
  error: unknown,
): FailureInput {
  return {
    source: "launch",
    error,
    context: {
      routeFamily: new URL(req.url).pathname,
      operation,
      method: req.method,
    },
  };
}

export function isValidProjectId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

// Reads are account- and source-scoped. The promise cache also coalesces
// concurrent widgets onto one manager request.
const CACHE_TTL_MS = 15_000;

export const readCache = {
  projects: new TimedPromiseCache<UserProject[]>(CACHE_TTL_MS),
  transactions: new TimedPromiseCache<OperateTransactionsResult>(CACHE_TTL_MS),
  usage: new TimedPromiseCache<OperateUsageResult>(CACHE_TTL_MS),
  statement: new TimedPromiseCache<OperateStatementResult>(CACHE_TTL_MS),
  logs: new TimedPromiseCache<OperateLogsResult>(CACHE_TTL_MS),
  observability: new TimedPromiseCache<OperateObservabilityResult>(
    CACHE_TTL_MS,
  ),
  observabilityBatch: new TimedPromiseCache<OperateObservabilitySnapshot[]>(
    CACHE_TTL_MS,
  ),
  paymentsBatch: new TimedPromiseCache<OperatePaymentProjectResult[]>(
    CACHE_TTL_MS,
  ),
  transactionsBatch: new TimedPromiseCache<UserTransactionsResult>(
    CACHE_TTL_MS,
  ),
  statementsBatch: new TimedPromiseCache<OperateStatementResult[]>(
    CACHE_TTL_MS,
  ),
  usageBatch: new TimedPromiseCache<OperateUsageResult[]>(CACHE_TTL_MS),
  logsBatch: new TimedPromiseCache<UserLogsResult>(CACHE_TTL_MS),
  appDetail: new TimedPromiseCache<OperateAppDetailResult>(CACHE_TTL_MS),
  deployments: new TimedPromiseCache<UserProjectLatestDeployment[]>(
    CACHE_TTL_MS,
  ),
};

// Test seam: caches would otherwise leak one test's reads into the next.
export function clearOperateCachesForTesting() {
  Object.values(readCache).forEach((cache) => cache.clear());
}

type OperateScope = {
  githubUserId: string;
  platform: string;
  projects: UserProject[];
  client: BackendClientInstance;
};

/** Session, platform, and a live client — everything a read needs *except* the
 *  source list, which costs its own manager round trip. Splitting it out lets
 *  the account-wide reads start their real query immediately instead of
 *  waterfalling behind a list they only use to populate a filter dropdown. */
type OperateSession = {
  githubUserId: string;
  platform: string;
  client: BackendClientInstance;
  /** The signed-in user's account-wide projects, resolved lazily. Ownership
   *  checks read this one: a partner-bound project must still be provable as
   *  this user's even while another platform is selected. */
  projects: () => Promise<UserProject[]>;
  /** The projects the selected platform actually shows, resolved lazily —
   *  the exact list behind `/projects`. Every page under one platform must
   *  agree on this set, so account-wide reads narrow their results to it. */
  platformProjects: () => Promise<UserProject[]>;
};

/** Ids of the projects visible on the selected platform. Account-wide manager
 *  batches answer for every platform the account owns (deliberately — the
 *  per-project read rejects partner-bound projects as not launch-relevant on
 *  the default platform), so the platform scope is applied to the response. */
export function platformProjectIds(projects: UserProject[]): Set<number> {
  return new Set(projects.map((project) => project.id));
}

/** Keep only the rows whose project is on the selected platform. Rows with no
 *  project (account-level partner settlements) belong to every platform view
 *  and are kept. */
export function onPlatform<T extends { project?: { id: number } | null }>(
  rows: T[],
  ids: Set<number>,
): T[] {
  return rows.filter((row) => !row.project || ids.has(row.project.id));
}

export async function operateSession(
  req: Request,
): Promise<{ response: Response } | OperateSession> {
  try {
    const auth = await authorize(req);
    if ("response" in auth) return auth;
    const { session, visibilityGrant } = auth;
    const config = deployConfig();
    const params = new URL(req.url).searchParams;
    const requestedPlatform = params.get("platform") ?? undefined;
    const platform = resolveDeployPlatform(requestedPlatform, config);
    if (!platform) {
      return {
        response: Response.json(
          { error: "missing or invalid `platform`" },
          { status: 400 },
        ),
      };
    }
    const client = await backendClient();
    return {
      githubUserId: session.githubUserId,
      platform,
      client,
      projects: () =>
        readCache.projects.get(
          [session.githubUserId, null, visibilityGrant ?? ""],
          () =>
            client.listUserProjects({
              githubUserId: session.githubUserId,
              platform: undefined,
              ...(visibilityGrant ? { visibilityGrant } : {}),
            }),
        ),
      platformProjects: () =>
        readCache.projects.get(
          [session.githubUserId, platform, visibilityGrant ?? ""],
          () =>
            client.listUserProjects({
              githubUserId: session.githubUserId,
              platform,
              ...(visibilityGrant ? { visibilityGrant } : {}),
            }),
        ),
    };
  } catch (err) {
    return {
      response: buildFailures.handle({
        source: "launch",
        error: err,
        context: {
          routeFamily: new URL(req.url).pathname,
          operation: "operate.owned_sources",
          method: req.method,
        },
      }).response,
    };
  }
}

/** A single-source scope: `projectId` is validated as this user's, so the
 *  source list is genuinely on the critical path. Also the scope for reads
 *  whose whole answer is the list itself (bots, model keys). */
export async function ownedSources(
  req: Request,
): Promise<{ response: Response } | OperateScope> {
  const session = await operateSession(req);
  if ("response" in session) return session;
  try {
    const params = new URL(req.url).searchParams;
    const projects = await session.projects();
    if (!params.has("projectId")) {
      return { ...session, projects };
    }
    const requestedProjectId = Number(params.get("projectId"));
    if (!isValidProjectId(requestedProjectId)) {
      return {
        response: Response.json(
          { error: "missing or invalid `projectId`" },
          { status: 400 },
        ),
      };
    }
    const project = projects.find(
      (candidate) => candidate.id === requestedProjectId,
    );
    if (!project) {
      return {
        response: Response.json(
          { error: "project not found for this user" },
          { status: 404 },
        ),
      };
    }
    return {
      ...session,
      platform: project.platformName,
      projects: [project],
    };
  } catch (err) {
    return {
      response: buildFailures.handle({
        source: "launch",
        error: err,
        context: {
          routeFamily: new URL(req.url).pathname,
          operation: "operate.owned_sources",
          method: req.method,
        },
      }).response,
    };
  }
}

/** Scope for the account-wide reads. `projects` is a lazy, memoised thunk
 *  rather than a resolved list — calling it STARTS the read, so a route kicks
 *  it off before awaiting its own manager query and `Promise.all`s the two
 *  together. Routes whose response never mentions the source list (payments)
 *  simply never call it and pay nothing for it.
 *
 *  A request that names an `projectId` falls back to the resolved scope,
 *  because the id must be proven to belong to this user before it can be
 *  forwarded to the manager. */
export async function batchScope(req: Request): Promise<
  | { response: Response }
  | {
      githubUserId: string;
      platform: string;
      client: BackendClientInstance;
      /** Set only for a single-source view; already validated as owned. */
      projectId: number | undefined;
      projects: () => Promise<UserProject[]>;
      platformProjects: () => Promise<UserProject[]>;
    }
> {
  if (new URL(req.url).searchParams.has("projectId")) {
    const owned = await ownedSources(req);
    if ("response" in owned) return owned;
    // The named project IS the scope — it was resolved by id and carries its
    // own platform binding, so there is nothing left to narrow.
    return {
      ...owned,
      projectId: owned.projects[0]?.id,
      projects: () => Promise.resolve(owned.projects),
      platformProjects: () => Promise.resolve(owned.projects),
    };
  }
  const session = await operateSession(req);
  if ("response" in session) return session;
  return {
    githubUserId: session.githubUserId,
    platform: session.platform,
    client: session.client,
    projectId: undefined,
    projects: session.projects,
    platformProjects: session.platformProjects,
  };
}
