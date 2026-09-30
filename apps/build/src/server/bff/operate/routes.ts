import "server-only";

import { NextResponse } from "next/server";
import type { FailureInput } from "@aomi-labs/bff-observability";
import type {
  BotRegistration,
  OperateLogCursor,
  OperateLogsResult,
  OperateAppDetailResult,
  OperateObservabilityResult,
  OperateObservabilitySnapshot,
  OperatePaymentProjectResult,
  OperatePartnerPayments,
  OperateStatementResult,
  OperateTransactionCursor,
  OperateTransactionsResult,
  OperateUsageResult,
  UserLogsResult,
  UserProject,
  UserProjectLatestDeployment,
  UserTransactionsResult,
} from "@aomi-labs/deploy";
import {
  EXAMPLE_PROJECT,
  exampleStatement,
} from "@build/features/operate/fixtures/wire";
import {
  caipChainId,
  caipChainLabel,
  creditsToUsd,
} from "@build/features/operate/format";
import { backendClient } from "@build/server/bff/backend";
import { authorize } from "@build/server/bff/auth";
import {
  launchConfig,
  resolveLaunchPlatform,
} from "@build/server/bff/launch/config";
import { buildFailures } from "@build/server/bff/failures";
import { TimedPromiseCache } from "@build/server/bff/timed-promise-cache";

type BackendClientInstance = Awaited<ReturnType<typeof backendClient>>;

function identifyOperateFailure(
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

// An unbounded fan-out is a thundering herd: an account with 100+ projects fired
// every per-source read at once and saturated the manager's connection pool, so
// most reads timed out waiting to acquire and the page hung on "Loading". Cap
// the wave instead — the pool is the scarce resource, not our event loop.
const SOURCE_FANOUT_LIMIT = 6;

// Beyond this a source is treated as unavailable rather than allowed to hold a
// fan-out slot (and the whole page) open. Comfortably above a healthy read.
const SOURCE_READ_TIMEOUT_MS = 8_000;

// Capping concurrency alone still lets a degraded manager stretch a large
// account over batches × timeout. Bound the whole fan-out too: projects we never
// got to are dropped like any other failure, so the page renders what it has
// instead of stalling. Well under the platform's function timeout.
const SOURCE_FANOUT_BUDGET_MS = 20_000;

async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = {
          status: "fulfilled",
          value: await run(items[index]),
        };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

// Losing the race does not cancel the underlying read — it stays in the promise
// cache and can still land for the next request, which is what we want.
function withTimeout<T>(
  load: () => Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  if (ms <= 0) {
    return Promise.reject(new Error(`${label} skipped: fan-out budget spent`));
  }
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    load(),
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

type Settled<T> = {
  ok: T[];
  /** Source ids this read could not cover (feeds the all-dropped guard). */
  dropped: number[];
};

// Fan out a per-source read and keep only the projects that succeed. One source
// failing — a freshly scaffolded source with no deployed app, or a transient
// backend blip — must not take down the whole operate page; drop it and render
// the healthy projects instead of failing the entire request. Report what was
// lost: a page silently missing most of the account reads as a complete page.
async function settleBySource<T>(
  projects: UserProject[],
  operation: string,
  run: (source: UserProject) => Promise<T>,
): Promise<Settled<T>> {
  const deadline = Date.now() + SOURCE_FANOUT_BUDGET_MS;
  const settled = await mapWithLimit(projects, SOURCE_FANOUT_LIMIT, (source) =>
    withTimeout(
      () => run(source),
      Math.min(SOURCE_READ_TIMEOUT_MS, deadline - Date.now()),
      `operate read for source ${source.id}`,
    ),
  );
  const ok: T[] = [];
  const dropped: number[] = [];
  settled.forEach((result, index) => {
    const source = projects[index];
    if (result.status === "fulfilled") {
      ok.push(result.value);
    } else {
      if (source) dropped.push(source.id);
      buildFailures.handle({
        source: "launch",
        error: result.reason,
        context: {
          routeFamily: "/api/bff/operate",
          operation,
          method: "GET",
        },
      });
    }
  });
  return { ok, dropped };
}

// The per-source fallback can drop projects; losing every read used to render
// an empty page behind a warning banner (and Usage then swapped in the
// example statement). An outage should look like an outage: fail the request
// and let the view's error state own it. `ok` counts successful reads, not
// rows, so a healthy-but-empty account never trips this; a skipped leg
// (statements past page one) contributes an empty `ok` and is outvoted by
// the leg that ran.
function nothingRead(
  projects: UserProject[],
  ...reads: Array<{ ok: unknown[] }>
) {
  return projects.length > 0 && reads.every((read) => read.ok.length === 0);
}

function operateUnavailableResponse() {
  return NextResponse.json(
    { error: "Operate reads are temporarily unavailable — retry shortly." },
    { status: 503 },
  );
}

function isValidProjectId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Shape-only check of the bot-level command config. The manager is the
 *  authority on URL schemes, command names, the reserved list and the
 *  endpoint-required rule; its `error` string is forwarded to the UI as-is.
 *  Omitted fields are omitted from the forwarded body (= unchanged on PATCH);
 *  `""` normalises to `null` for the URL fields, which the backend does too. */
function botCommandConfig(body: {
  miniAppUrl?: unknown;
  commandEndpoint?: unknown;
  commands?: unknown;
}):
  | {
      miniAppUrl?: string | null;
      commandEndpoint?: string | null;
      commands?: string[];
    }
  | { response: NextResponse } {
  const url = (value: unknown) =>
    value === undefined || value === null || typeof value === "string";
  if (
    !url(body.miniAppUrl) ||
    !url(body.commandEndpoint) ||
    (body.commands !== undefined &&
      (!Array.isArray(body.commands) ||
        body.commands.some((command) => typeof command !== "string")))
  ) {
    return {
      response: NextResponse.json(
        { error: "invalid bot command config" },
        { status: 400 },
      ),
    };
  }
  const clear = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : null;
  return {
    ...(body.miniAppUrl !== undefined
      ? { miniAppUrl: clear(body.miniAppUrl) }
      : {}),
    ...(body.commandEndpoint !== undefined
      ? { commandEndpoint: clear(body.commandEndpoint) }
      : {}),
    ...(body.commands !== undefined
      ? { commands: body.commands as string[] }
      : {}),
  };
}

function pageLimit(params: URLSearchParams, fallback: number, max: number) {
  const value = Number(params.get("limit") ?? String(fallback));
  return Number.isSafeInteger(value) && value > 0
    ? Math.min(value, max)
    : fallback;
}

type CompositeCursor = {
  /** Per-source cursors from the fallback fan-out. */
  perSource?: Record<string, unknown>;
  /** The batch endpoints paginate the merged stream with one global cursor. */
  batch?: unknown;
};

function parseCompositeCursor(value: string | null): CompositeCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as CompositeCursor;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function sourceCursor(
  cursor: CompositeCursor | null,
  projectId: number,
): unknown | undefined {
  return cursor?.perSource?.[String(projectId)];
}

function transactionCursorFor(row: {
  createdAt: number;
  id: string;
}): OperateTransactionCursor {
  return { createdAt: row.createdAt, id: row.id };
}

function logCursorFor(row: {
  occurredAt: number;
  eventType: string;
  id: string;
}): OperateLogCursor {
  return {
    occurredAt: row.occurredAt,
    eventType: row.eventType,
    id: row.id,
  };
}

function mergedPartnerPayments(
  rows: Array<{
    project: OperatePaymentProjectResult["project"];
    payments: OperatePartnerPayments;
  }>,
) {
  const sum = (pick: (summary: OperatePartnerPayments["summary"]) => number) =>
    rows.reduce((total, row) => total + pick(row.payments.summary), 0);
  const eventById = new Map<
    string,
    OperatePartnerPayments["events"][number] & {
      project: OperatePaymentProjectResult["project"];
    }
  >();
  for (const row of rows) {
    for (const event of row.payments.events) {
      const key = `${event.kind}:${event.id}`;
      const existing = eventById.get(key);
      if (!existing) {
        eventById.set(key, { ...event, project: row.project });
      } else if (existing.applicationId !== event.applicationId) {
        // A recipient-bucket settlement can clear fees for apps in multiple
        // projects. It belongs to the beneficiary, not whichever project the
        // BFF happened to merge first.
        existing.application = null;
        existing.applicationId = null;
      }
    }
  }
  const events = [...eventById.values()].sort(
    (a, b) => b.occurredAt - a.occurredAt || b.id.localeCompare(a.id),
  );
  const buckets = [
    ...new Map(
      rows.flatMap((row) =>
        row.payments.buckets.map((bucket) => [bucket.id, bucket]),
      ),
    ).values(),
  ];
  const settlementEvents = events.filter(
    (event) => event.kind === "settlement_confirmed",
  );
  const outstandingCredits = buckets.reduce(
    (total, bucket) => total + bucket.outstandingCredits,
    0,
  );
  return {
    available: rows.some((row) => row.payments.available),
    scope: "recipient_bucket",
    summary: {
      accruedCredits: sum((summary) => summary.accruedCredits),
      accruedUsd: sum((summary) => summary.accruedUsd),
      settledCredits: settlementEvents.reduce(
        (total, event) => total + event.credits,
        0,
      ),
      settledUsd: settlementEvents.reduce(
        (total, event) => total + event.usd,
        0,
      ),
      outstandingCredits,
      outstandingUsd: creditsToUsd(outstandingCredits),
      pricedCalls: sum((summary) => summary.pricedCalls),
      settlements: settlementEvents.length,
    },
    resources: rows.flatMap((row) =>
      row.payments.resources.map((resource) => ({
        ...resource,
        project: row.project,
      })),
    ),
    buckets,
    events,
  };
}

function mergedNextCursor<T extends { project: { id: number } }>(
  previous: CompositeCursor | null,
  visible: T[],
  allRows: T[],
  results: Array<{ nextCursor: unknown }>,
  cursorFor: (row: T) => unknown,
): CompositeCursor | null {
  const hasMore =
    allRows.length > visible.length ||
    results.some((result) => result.nextCursor != null);
  if (!hasMore) return null;
  const perSource: Record<string, unknown> = {
    ...(previous?.perSource ?? {}),
  };
  for (const row of visible) {
    perSource[String(row.project.id)] = cursorFor(row);
  }
  return { perSource };
}

// Reads are account- and source-scoped. The promise cache also coalesces
// concurrent widgets onto one manager request.
const CACHE_TTL_MS = 15_000;
const readCache = {
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
function platformProjectIds(projects: UserProject[]): Set<number> {
  return new Set(projects.map((project) => project.id));
}

/** Keep only the rows whose project is on the selected platform. Rows with no
 *  project (account-level partner settlements) belong to every platform view
 *  and are kept. */
function onPlatform<T extends { project?: { id: number } | null }>(
  rows: T[],
  ids: Set<number>,
): T[] {
  return rows.filter((row) => !row.project || ids.has(row.project.id));
}

async function operateSession(
  req: Request,
): Promise<{ response: Response } | OperateSession> {
  try {
    const auth = await authorize(req);
    if ("response" in auth) return auth;
    const { session, visibilityGrant } = auth;
    const config = launchConfig();
    const params = new URL(req.url).searchParams;
    const requestedPlatform = params.get("platform") ?? undefined;
    const platform = resolveLaunchPlatform(requestedPlatform, config);
    if (!platform) {
      return {
        response: NextResponse.json(
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
async function ownedSources(
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
        response: NextResponse.json(
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
        response: NextResponse.json(
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
async function batchScope(req: Request): Promise<
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

export async function operateBotsRoute(req: Request) {
  const owned = await ownedSources(req);
  if ("response" in owned) return owned.response;
  try {
    const bots = await owned.client.listUserBots({
      githubUserId: owned.githubUserId,
    });
    return NextResponse.json({
      projects: owned.projects,
      bots,
    });
  } catch (err) {
    return buildFailures.handle(
      identifyOperateFailure(req, "operate.bots_read", err),
    ).response;
  }
}

export async function operateBotsCreateRoute(req: Request) {
  const owned = await ownedSources(req);
  if ("response" in owned) return owned.response;

  const body = (await req.json().catch(() => ({}))) as {
    applicationIds?: unknown;
    handoverApplicationId?: unknown;
    credential?: unknown;
    label?: unknown;
    threadMode?: unknown;
    miniAppUrl?: unknown;
    commandEndpoint?: unknown;
    commands?: unknown;
  };
  if (
    !Array.isArray(body.applicationIds) ||
    body.applicationIds.length === 0 ||
    body.applicationIds.some((id) => typeof id !== "number") ||
    typeof body.handoverApplicationId !== "number"
  ) {
    return NextResponse.json(
      { error: "missing or invalid app mappings" },
      { status: 400 },
    );
  }
  const commandConfig = botCommandConfig(body);
  if ("response" in commandConfig) return commandConfig.response;
  if (typeof body.credential !== "string" || !body.credential.trim()) {
    return NextResponse.json(
      { error: "missing `credential`" },
      { status: 400 },
    );
  }
  const allowedApplicationIds = new Set(
    owned.projects.flatMap((source) =>
      (source.apps ?? []).map((app) => app.id),
    ),
  );
  const applicationIds = body.applicationIds as number[];
  if (new Set(applicationIds).size !== applicationIds.length) {
    return NextResponse.json(
      { error: "`applicationIds` must be unique" },
      { status: 400 },
    );
  }
  if (
    !applicationIds.every((id) => allowedApplicationIds.has(id)) ||
    !applicationIds.includes(body.handoverApplicationId)
  ) {
    return NextResponse.json(
      { error: "selected apps are not owned by this user" },
      { status: 403 },
    );
  }

  try {
    const bot: BotRegistration = await owned.client.createUserBot({
      githubUserId: owned.githubUserId,
      applicationIds,
      handoverApplicationId: body.handoverApplicationId,
      botPlatform: "telegram",
      credential: body.credential.trim(),
      label: typeof body.label === "string" ? body.label : undefined,
      threadMode:
        typeof body.threadMode === "string" ? body.threadMode : undefined,
      ...commandConfig,
    });
    return NextResponse.json({ bot }, { status: 201 });
  } catch (err) {
    return buildFailures.handle(
      identifyOperateFailure(req, "operate.bots_create", err),
    ).response;
  }
}

export async function operateBotsDeleteRoute(req: Request) {
  const owned = await ownedSources(req);
  if ("response" in owned) return owned.response;

  const params = new URL(req.url).searchParams;
  const botId = params.get("botId");
  if (!botId) {
    return NextResponse.json({ error: "missing `botId`" }, { status: 400 });
  }
  try {
    await owned.client.deleteUserBot({
      githubUserId: owned.githubUserId,
      botId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return buildFailures.handle(
      identifyOperateFailure(req, "operate.bots_delete", err),
    ).response;
  }
}

export async function operateBotsUpdateRoute(req: Request) {
  const owned = await ownedSources(req);
  if ("response" in owned) return owned.response;
  const body = (await req.json().catch(() => ({}))) as {
    botId?: unknown;
    applicationIds?: unknown;
    handoverApplicationId?: unknown;
    threadMode?: unknown;
    miniAppUrl?: unknown;
    commandEndpoint?: unknown;
    commands?: unknown;
  };
  if (
    typeof body.botId !== "string" ||
    !Array.isArray(body.applicationIds) ||
    body.applicationIds.length === 0 ||
    body.applicationIds.some((id) => typeof id !== "number") ||
    typeof body.handoverApplicationId !== "number"
  ) {
    return NextResponse.json(
      { error: "invalid bot mapping update" },
      { status: 400 },
    );
  }
  const commandConfig = botCommandConfig(body);
  if ("response" in commandConfig) return commandConfig.response;
  // Optional settings patch: omitted leaves the stored value unchanged.
  if (
    body.threadMode !== undefined &&
    body.threadMode !== "single" &&
    body.threadMode !== "multi"
  ) {
    return NextResponse.json(
      { error: "invalid `threadMode`" },
      { status: 400 },
    );
  }
  const allowed = new Set(
    owned.projects.flatMap((source) =>
      (source.apps ?? []).map((app) => app.id),
    ),
  );
  const applicationIds = body.applicationIds as number[];
  if (new Set(applicationIds).size !== applicationIds.length) {
    return NextResponse.json(
      { error: "`applicationIds` must be unique" },
      { status: 400 },
    );
  }
  if (
    !applicationIds.every((id) => allowed.has(id)) ||
    !applicationIds.includes(body.handoverApplicationId)
  ) {
    return NextResponse.json(
      { error: "selected apps are not owned by this user" },
      { status: 403 },
    );
  }
  try {
    // The manager re-asserts the Telegram webhook after every save; a
    // failure there is a warning beside the saved bot, not a failed save.
    const { webhookWarning, ...bot } = await owned.client.updateUserBot({
      githubUserId: owned.githubUserId,
      botId: body.botId,
      applicationIds,
      handoverApplicationId: body.handoverApplicationId,
      threadMode: body.threadMode,
      ...commandConfig,
    });
    return NextResponse.json({
      bot,
      ...(webhookWarning ? { webhookWarning } : {}),
    });
  } catch (err) {
    return buildFailures.handle(
      identifyOperateFailure(req, "operate.bots_update", err),
    ).response;
  }
}

/// GET /operate/bots/:botId/command-secret → { commandSecret }. Same scope
/// as the update route: the session's builder id goes to the manager, which
/// enforces bot ownership. The secret is never logged or cached here.
export async function operateBotsCommandSecretRoute(req: Request) {
  const owned = await ownedSources(req);
  if ("response" in owned) return owned.response;
  const segments = new URL(req.url).pathname.split("/");
  const botId = decodeURIComponent(
    segments[segments.indexOf("bots") + 1] ?? "",
  );
  if (!botId || botId === "command-secret") {
    return NextResponse.json({ error: "missing `botId`" }, { status: 400 });
  }
  try {
    const { commandSecret } = await owned.client.revealUserBotCommandSecret({
      githubUserId: owned.githubUserId,
      botId,
    });
    return NextResponse.json(
      { commandSecret },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return buildFailures.handle(
      identifyOperateFailure(req, "operate.bots_command_secret", err),
    ).response;
  }
}

/// POST /operate/bots/:botId/webhook → { webhook }. Asks the manager to
/// compare Telegram's registered webhook with its own URL for the bot and
/// re-assert it on a mismatch. Only the comparison and Telegram's delivery
/// stats come back; the URL, secret and token never do.
export async function operateBotsWebhookRoute(req: Request) {
  const owned = await ownedSources(req);
  if ("response" in owned) return owned.response;
  const segments = new URL(req.url).pathname.split("/");
  const botId = decodeURIComponent(
    segments[segments.indexOf("bots") + 1] ?? "",
  );
  if (!botId || botId === "webhook") {
    return NextResponse.json({ error: "missing `botId`" }, { status: 400 });
  }
  try {
    const webhook = await owned.client.checkUserBotWebhook({
      githubUserId: owned.githubUserId,
      botId,
    });
    return NextResponse.json(
      { webhook },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return buildFailures.handle(
      identifyOperateFailure(req, "operate.bots_webhook", err),
    ).response;
  }
}

// ── model keys (funder-ladder app rung, builder-owned) ─────────────────────

/// GET → { projects, keys }: the builder's key inventory with grants, plus
/// their projects (for the "apply to projects" picker). Never key material.
export async function operateModelKeysRoute(req: Request) {
  const owned = await ownedSources(req);
  if ("response" in owned) return owned.response;
  try {
    const keys = await owned.client.listBuilderModelKeys({
      githubUserId: owned.githubUserId,
      platform: owned.platform,
    });
    return NextResponse.json({ projects: owned.projects, keys });
  } catch (err) {
    return buildFailures.handle(
      identifyOperateFailure(req, "operate.model_keys_read", err),
    ).response;
  }
}

/// POST { provider, key, label? } → create; with `keyId` → rotate in place.
export async function operateModelKeysSaveRoute(req: Request) {
  const owned = await ownedSources(req);
  if ("response" in owned) return owned.response;

  const body = (await req.json().catch(() => ({}))) as {
    keyId?: unknown;
    provider?: unknown;
    key?: unknown;
    label?: unknown;
  };
  if (typeof body.provider !== "string" || !body.provider.trim()) {
    return NextResponse.json({ error: "missing `provider`" }, { status: 400 });
  }
  if (typeof body.key !== "string" || !body.key.trim()) {
    return NextResponse.json({ error: "missing `key`" }, { status: 400 });
  }
  if (body.keyId !== undefined && typeof body.keyId !== "number") {
    return NextResponse.json({ error: "invalid `keyId`" }, { status: 400 });
  }

  try {
    const key = await owned.client.saveBuilderModelKey({
      githubUserId: owned.githubUserId,
      platform: owned.platform,
      keyId: body.keyId as number | undefined,
      provider: body.provider.trim(),
      key: body.key.trim(),
      label: typeof body.label === "string" ? body.label : undefined,
    });
    return NextResponse.json({ key }, { status: 201 });
  } catch (err) {
    return buildFailures.handle(
      identifyOperateFailure(req, "operate.model_keys_save", err),
    ).response;
  }
}

/// PUT { keyId, applicationIds } → replace the key's grant set.
export async function operateModelKeysGrantsRoute(req: Request) {
  const owned = await ownedSources(req);
  if ("response" in owned) return owned.response;

  const body = (await req.json().catch(() => ({}))) as {
    keyId?: unknown;
    applicationIds?: unknown;
  };
  if (
    typeof body.keyId !== "number" ||
    !Array.isArray(body.applicationIds) ||
    body.applicationIds.some((id) => typeof id !== "number")
  ) {
    return NextResponse.json(
      { error: "missing or invalid `keyId` / `applicationIds`" },
      { status: 400 },
    );
  }

  try {
    const key = await owned.client.setModelKeyGrants({
      githubUserId: owned.githubUserId,
      platform: owned.platform,
      keyId: body.keyId,
      applicationIds: body.applicationIds as number[],
    });
    return NextResponse.json({ key });
  } catch (err) {
    return buildFailures.handle(
      identifyOperateFailure(req, "operate.model_keys_grants", err),
    ).response;
  }
}

export async function operateModelKeysDeleteRoute(req: Request) {
  const owned = await ownedSources(req);
  if ("response" in owned) return owned.response;

  const params = new URL(req.url).searchParams;
  const keyId = Number(params.get("keyId"));
  if (!Number.isFinite(keyId) || keyId <= 0) {
    return NextResponse.json(
      { error: "missing or invalid `keyId`" },
      { status: 400 },
    );
  }

  try {
    await owned.client.deleteBuilderModelKey({
      githubUserId: owned.githubUserId,
      platform: owned.platform,
      keyId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return buildFailures.handle(
      identifyOperateFailure(req, "operate.model_keys_delete", err),
    ).response;
  }
}

export async function operateTransactionsRoute(req: Request) {
  try {
    const scope = await batchScope(req);
    if ("response" in scope) return scope.response;
    // Started before the reads below so it overlaps them.
    const sourcesPending = scope.platformProjects();
    const params = new URL(req.url).searchParams;
    const limit = pageLimit(params, 50, 100);
    const cursor = parseCompositeCursor(params.get("cursor"));
    const status = params.get("status") ?? undefined;
    const requestedPlatform = params.get("platform") ?? undefined;

    // Account-wide reads go through the manager's batch endpoints: one merged
    // transactions page plus one statement sweep, instead of 2×N per-source
    // reads that saturated the manager on large accounts. Without an explicit
    // `platform`, the manager resolves each source under its own bound/loaded
    // platform, which also covers partner-bound projects. A single-source view
    // stays on the per-source reads — one call each, and the cursor there is
    // per-source anyway.
    //
    // The source list resolves alongside them rather than ahead of them: it
    // only feeds the filter dropdown, so making the page's real reads wait on
    // it added a whole manager round trip to first paint.
    let batch: {
      page: UserTransactionsResult;
      statements: OperateStatementResult[];
    } | null = null;
    if (scope.projectId === undefined) {
      const [page, statements] = await Promise.all([
        readCache.transactionsBatch.get(
          [
            scope.githubUserId,
            requestedPlatform ?? null,
            { limit, status, cursor: cursor?.batch ?? null },
          ],
          () =>
            scope.client.listUserTransactions({
              githubUserId: scope.githubUserId,
              limit,
              status,
              cursor: (cursor?.batch ?? undefined) as
                | OperateTransactionCursor
                | undefined,
            }),
        ),
        cursor
          ? Promise.resolve([] as OperateStatementResult[])
          : readCache.statementsBatch.get(
              [scope.githubUserId, requestedPlatform ?? null, null, null],
              () =>
                scope.client.getUserStatements({
                  githubUserId: scope.githubUserId,
                }),
            ),
      ]);
      batch = { page, statements };
    }
    const owned = { ...scope, projects: await sourcesPending };

    let appTransactions: Array<Record<string, any>>;
    let statements: OperateStatementResult[];
    let nextCursor: CompositeCursor | null;
    if (batch) {
      const sourceById = new Map(
        batch.page.projects.map((ref) => [ref.project.id, ref.project]),
      );
      // The manager batch answers for every platform the account owns; narrow
      // it to the platform this page is scoped to before anything is rendered.
      const platformIds = platformProjectIds(owned.projects);
      appTransactions = onPlatform(
        batch.page.transactions.map(
          ({ projectId, platform, ...transaction }) => ({
            ...transaction,
            kind: "app_transaction",
            project:
              (projectId != null ? sourceById.get(projectId) : undefined) ??
              null,
            platform: platform ?? owned.platform,
          }),
        ),
        platformIds,
      );
      statements = onPlatform(batch.statements, platformIds);
      nextCursor = batch.page.nextCursor
        ? { batch: batch.page.nextCursor }
        : null;
    } else {
      const [transactionReads, statementReads] = await Promise.all([
        settleBySource<OperateTransactionsResult>(
          owned.projects,
          "operate.transactions_source",
          (source) =>
            readCache.transactions.get(
              [
                owned.githubUserId,
                owned.platform,
                source.id,
                { limit, status, cursor: sourceCursor(cursor, source.id) },
              ],
              () =>
                owned.client.listUserProjectTransactions({
                  githubUserId: owned.githubUserId,
                  projectId: source.id,
                  limit,
                  status,
                  cursor: sourceCursor(cursor, source.id) as
                    | OperateTransactionCursor
                    | string
                    | undefined,
                }),
            ),
        ),
        cursor
          ? Promise.resolve({
              ok: [],
              dropped: [],
            } as Settled<OperateStatementResult>)
          : settleBySource<OperateStatementResult>(
              owned.projects,
              "operate.transactions_statement",
              (source) =>
                readCache.statement.get(
                  [owned.githubUserId, owned.platform, source.id, null],
                  () =>
                    owned.client.getUserProjectStatement({
                      githubUserId: owned.githubUserId,
                      projectId: source.id,
                    }),
                ),
            ),
      ]);
      if (nothingRead(owned.projects, transactionReads, statementReads)) {
        return operateUnavailableResponse();
      }
      const results = transactionReads.ok;
      appTransactions = results
        .flatMap((result) =>
          result.transactions.map((transaction) => ({
            ...transaction,
            kind: "app_transaction",
            project: result.project,
            platform: result.platform,
          })),
        )
        .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
      statements = statementReads.ok;
      nextCursor = mergedNextCursor(
        cursor,
        appTransactions.slice(0, limit) as Array<{
          project: { id: number };
          createdAt: number;
          id: string;
        }>,
        appTransactions as Array<{
          project: { id: number };
          createdAt: number;
          id: string;
        }>,
        results,
        transactionCursorFor,
      );
    }
    const payments = mergedPartnerPayments(
      statements.map((statement) => ({
        project: statement.project as UserProject,
        payments: statement.payments,
      })),
    );
    const payouts =
      params.get("status") && params.get("status") !== "confirmed"
        ? []
        : payments.events
            .filter((event) => event.kind === "settlement_confirmed")
            .map((event) => {
              const provider =
                event.paymentMethod.toLowerCase() === "coinbase"
                  ? "Coinbase"
                  : event.paymentMethod;
              return {
                id: `partner-payout:${event.id}`,
                kind: "partner_payout",
                externalTxId: event.receiptId ?? event.id,
                application: event.application ?? "Partner payout",
                applicationId: event.applicationId,
                status: "confirmed",
                txHash: event.receiptId,
                chainId: caipChainId(event.chain),
                fromAddress: "",
                toAddress: event.recipient,
                value: `${event.assetAmount ?? event.usd} ${event.asset ?? "USD"}`,
                hasCalldata: false,
                calldataPreview: null,
                description: `Partner settlement via ${provider}`,
                createdAt: event.occurredAt,
                updatedAt: event.occurredAt,
                submittedAt: event.occurredAt,
                family: "evm",
                chainName: caipChainLabel(event.chain) || null,
                fromLabel: null,
                toLabel: "beneficiary",
                valueUsd: `$${event.usd.toFixed(2)}`,
                block: null,
                slot: null,
                confirmations: null,
                gasUsed: null,
                gasLimit: null,
                effGasPrice: null,
                computeUnits: null,
                computeLimit: null,
                priorityFee: null,
                txFee: null,
                platformFee: null,
                nonce: null,
                method: provider === "Coinbase" ? "Coinbase x402" : provider,
                transfers: [],
                revertReason: null,
                explorerUrl: event.explorerUrl,
                payment: {
                  credits: event.credits,
                  recipient: event.recipient,
                  scope: payments.scope,
                },
                project: event.project,
                platform: owned.platform,
              };
            });
    // Statement-backed payouts have no transaction cursor. Include the full
    // deduplicated overlay on page one, alongside one normal page of app
    // transactions, so an older settlement cannot be sliced out forever.
    const visibleAppTransactions = appTransactions.slice(0, limit);
    const transactions = [...visibleAppTransactions, ...payouts].sort(
      (a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id),
    );
    return NextResponse.json({
      // Every source the account owns, not just the ones this read covered:
      // the filter dropdown is how a user loads one source on its own.
      projects: owned.projects,
      transactions,
      nextCursor,
    });
  } catch (err) {
    return buildFailures.handle(
      identifyOperateFailure(req, "operate.transactions", err),
    ).response;
  }
}

export async function operateUsageRoute(req: Request) {
  try {
    const scope = await batchScope(req);
    if ("response" in scope) return scope.response;
    // Started before the reads below so it overlaps them.
    const sourcesPending = scope.platformProjects();
    const params = new URL(req.url).searchParams;
    const dates = {
      fromDate: params.get("fromDate") ?? undefined,
      toDate: params.get("toDate") ?? undefined,
    };
    const requestedPlatform = params.get("platform") ?? undefined;

    // Account-wide reads go through the manager's batch endpoints — one usage
    // sweep plus one statement sweep — instead of 2×N per-source reads. A
    // single-source view stays on the per-source reads (one call each). The
    // source list resolves alongside, not ahead: it only feeds the dropdown.
    let batch: {
      usage: OperateUsageResult[];
      statements: OperateStatementResult[];
    } | null = null;
    if (scope.projectId === undefined) {
      const [usage, statements] = await Promise.all([
        readCache.usageBatch.get(
          [
            scope.githubUserId,
            requestedPlatform ?? null,
            dates.fromDate ?? null,
            dates.toDate ?? null,
          ],
          () =>
            scope.client.getUserUsage({
              githubUserId: scope.githubUserId,
              ...dates,
            }),
        ),
        readCache.statementsBatch.get(
          [
            scope.githubUserId,
            requestedPlatform ?? null,
            dates.fromDate ?? null,
            dates.toDate ?? null,
          ],
          () =>
            scope.client.getUserStatements({
              githubUserId: scope.githubUserId,
              ...dates,
            }),
        ),
      ]);
      batch = { usage, statements };
    }
    const owned = { ...scope, projects: await sourcesPending };

    let results: OperateUsageResult[];
    let allStatements: OperateStatementResult[];
    if (batch) {
      // The manager batch answers for every platform the account owns; narrow
      // it to the platform this page is scoped to.
      const platformIds = platformProjectIds(owned.projects);
      results = onPlatform(batch.usage, platformIds);
      allStatements = onPlatform(batch.statements, platformIds);
    } else {
      const [usageReads, statementReads] = await Promise.all([
        settleBySource<OperateUsageResult>(
          owned.projects,
          "operate.usage_source",
          (source) =>
            readCache.usage.get(
              [owned.githubUserId, owned.platform, source.id, dates],
              () =>
                owned.client.getUserProjectUsage({
                  githubUserId: owned.githubUserId,
                  projectId: source.id,
                  ...dates,
                }),
            ),
        ),
        settleBySource<OperateStatementResult>(
          owned.projects,
          "operate.usage_statement",
          (source) =>
            readCache.statement.get(
              [owned.githubUserId, owned.platform, source.id, dates],
              () =>
                owned.client.getUserProjectStatement({
                  githubUserId: owned.githubUserId,
                  projectId: source.id,
                  ...dates,
                }),
            ),
        ),
      ]);
      if (nothingRead(owned.projects, usageReads, statementReads)) {
        return operateUnavailableResponse();
      }
      results = usageReads.ok;
      allStatements = statementReads.ok;
    }
    // The statement lives on its own manager endpoint. A backend with
    // `available: false` (statement_entries not migrated) drops out of
    // `statements`; until BE parity lands we serve the example statement
    // instead (flagged `example: true`) so the design ships visible.
    const statements = allStatements.filter((statement) => statement.available);
    const sum = (pick: (s: OperateStatementResult) => number) =>
      statements.reduce((total, statement) => total + pick(statement), 0);
    return NextResponse.json({
      // Every source the account owns, not just the ones this read covered:
      // the filter dropdown is how a user retries a dropped source on its own.
      projects: owned.projects,
      range: results[0]?.range ?? null,
      daily: results.flatMap((result) =>
        result.daily.map((row) => ({
          ...row,
          project: result.project,
          platform: result.platform,
        })),
      ),
      breakdown: results.flatMap((result) =>
        result.breakdown.map((row) => ({
          ...row,
          project: result.project,
          platform: result.platform,
        })),
      ),
      example: statements.length ? undefined : true,
      statement: statements.length
        ? {
            range: statements[0].range,
            summary: {
              grossRevenue: sum((s) => s.summary.grossRevenue),
              platformFees: sum((s) => s.summary.platformFees),
              serviceCharges: sum((s) => s.summary.serviceCharges),
              net: sum((s) => s.summary.net),
            },
            revenue: statements.flatMap((statement) =>
              statement.revenue.map((row) => ({
                ...row,
                project: statement.project,
              })),
            ),
            charges: statements.flatMap((statement) =>
              statement.charges.map((row) => ({
                ...row,
                project: statement.project,
              })),
            ),
            entries: statements
              .flatMap((statement) =>
                statement.entries.map((row) => ({
                  ...row,
                  project: statement.project,
                })),
              )
              .sort(
                (a, b) =>
                  b.day.localeCompare(a.day) ||
                  a.application.localeCompare(b.application),
              ),
            payments: mergedPartnerPayments(
              statements.map((statement) => ({
                project: statement.project as UserProject,
                payments: statement.payments,
              })),
            ),
          }
        : exampleStatement(owned.projects[0] ?? EXAMPLE_PROJECT),
    });
  } catch (err) {
    return buildFailures.handle(
      identifyOperateFailure(req, "operate.usage", err),
    ).response;
  }
}

export async function operateLogsRoute(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const limit = pageLimit(params, 100, 200);
    const cursor = parseCompositeCursor(params.get("cursor"));
    const type = params.get("type") ?? undefined;
    const requestedPlatform = params.get("platform") ?? undefined;

    // Account-wide reads go through the manager's batch endpoint: the merged
    // stream arrives already interleaved, deduplicated (a shared partner
    // settlement is one table row) and paginated by one global cursor, so
    // none of the per-source merge/dedupe below applies. A single-source view
    // stays on the per-source read.
    if (!params.has("projectId")) {
      const scope = await batchScope(req);
      if ("response" in scope) return scope.response;
      const sourcesPending = scope.platformProjects();
      const [batch, projects] = await Promise.all([
        readCache.logsBatch.get(
          [
            scope.githubUserId,
            requestedPlatform ?? null,
            { limit, type, cursor: cursor?.batch ?? null },
          ],
          () =>
            scope.client.listUserLogs({
              githubUserId: scope.githubUserId,
              limit,
              type,
              cursor: (cursor?.batch ?? undefined) as
                | OperateLogCursor
                | undefined,
            }),
        ),
        sourcesPending,
      ]);
      const sourceById = new Map(
        batch.projects.map((ref) => [ref.project.id, ref.project]),
      );
      return NextResponse.json({
        projects,
        // The merged stream covers every platform the account owns; narrow it
        // to the selected one. Account-level rows (a shared partner
        // settlement carries no projectId) stay.
        logs: onPlatform(
          batch.logs.map(({ projectId, platform, ...log }) => ({
            ...log,
            project:
              (projectId != null ? sourceById.get(projectId) : undefined) ??
              null,
            platform: platform ?? scope.platform,
          })),
          platformProjectIds(projects),
        ),
        nextCursor: batch.nextCursor ? { batch: batch.nextCursor } : null,
      });
    }

    const owned = await ownedSources(req);
    if ("response" in owned) return owned.response;
    const logReads = await settleBySource<OperateLogsResult>(
      owned.projects,
      "operate.logs_source",
      (source) =>
        readCache.logs.get(
          [
            owned.githubUserId,
            owned.platform,
            source.id,
            { limit, type, cursor: sourceCursor(cursor, source.id) },
          ],
          () =>
            owned.client.listUserProjectLogs({
              githubUserId: owned.githubUserId,
              projectId: source.id,
              limit,
              type,
              cursor: sourceCursor(cursor, source.id) as
                | OperateLogCursor
                | string
                | undefined,
            }),
        ),
    );
    if (nothingRead(owned.projects, logReads)) {
      return operateUnavailableResponse();
    }
    const results = logReads.ok;
    const sourcedLogs = results.flatMap((result) =>
      result.logs.map((entry) => ({
        ...entry,
        project: result.project,
        platform: result.platform,
      })),
    );
    const logById = new Map<
      string,
      (typeof sourcedLogs)[number] & { cursorSources: UserProject[] }
    >();
    for (const log of sourcedLogs) {
      const sharedSettlement = log.details.source === "partner_settlement";
      const key = sharedSettlement
        ? `partner-settlement:${log.id}`
        : `${log.project.id}:${log.eventType}:${log.id}`;
      const existing = logById.get(key);
      if (existing) {
        existing.cursorSources.push(log.project as UserProject);
      } else {
        logById.set(key, {
          ...log,
          cursorSources: [log.project as UserProject],
        });
      }
    }
    const logs = [...logById.values()].sort(
      (a, b) =>
        b.occurredAt - a.occurredAt ||
        b.eventType.localeCompare(a.eventType) ||
        b.id.localeCompare(a.id),
    );
    const visible = logs.slice(0, limit);
    const cursorRows = visible.flatMap((log) =>
      log.cursorSources.map((project) => ({ ...log, project })),
    );
    return NextResponse.json({
      // Every source the account owns, not just the ones this read covered:
      // the filter dropdown is how a user retries a dropped source on its own.
      projects: owned.projects,
      logs: visible.map(({ cursorSources: _cursorSources, ...log }) => log),
      nextCursor: mergedNextCursor(
        cursor,
        cursorRows,
        sourcedLogs,
        results,
        logCursorFor,
      ),
    });
  } catch (err) {
    return buildFailures.handle(
      identifyOperateFailure(req, "operate.logs", err),
    ).response;
  }
}

export async function operateObservabilityRoute(req: Request) {
  try {
    const requestedPlatform =
      new URL(req.url).searchParams.get("platform") ?? undefined;
    const scope = await batchScope(req);
    if ("response" in scope) return scope.response;
    const { projectId } = scope;
    // Kick the platform's source list off first so it overlaps the snapshot
    // below rather than following it.
    const sourcesPending = scope.platformProjects();

    // One manager request for the whole account. Without an explicit
    // `platform` filter the manager resolves each source under its own
    // bound/loaded platform, which also covers partner-bound projects that the
    // per-source read rejects as not launch-relevant on the default platform.
    // The platform scope is then applied here, so this page shows exactly the
    // projects `/projects` lists rather than every platform the account owns.
    const [results, projects] = await Promise.all([
      readCache.observabilityBatch.get(
        [scope.githubUserId, requestedPlatform ?? null, projectId ?? null],
        () =>
          scope.client.getUserObservability({
            githubUserId: scope.githubUserId,
            projectId,
          }),
      ) as Promise<OperateObservabilitySnapshot[]>,
      sourcesPending,
    ]);
    const scoped = onPlatform(results, platformProjectIds(projects));
    const apps = scoped.flatMap((result) =>
      result.apps.map((app) => ({
        ...app,
        project: result.project,
        platform: result.platform,
      })),
    );
    return NextResponse.json({
      // Every source on this platform, not just the ones this read covered:
      // the filter dropdown is how a user loads one source on its own.
      projects,
      scope: "owned_applications",
      monitoring: {
        provider: "grafana_prometheus",
        status: scoped.some((result) => result.monitoring?.status === "ok")
          ? scoped.some((result) => result.monitoring?.status !== "ok")
            ? "partial"
            : "ok"
          : (scoped[0]?.monitoring?.status ?? "unconfigured"),
        windowSeconds: scoped[0]?.monitoring?.windowSeconds ?? 0,
      },
      apps,
      dashboardLinks: scoped.flatMap((result) => result.dashboardLinks),
      platformMetrics: scoped[0]?.platformMetrics ?? [],
    });
  } catch (err) {
    return buildFailures.handle(
      identifyOperateFailure(req, "operate.observability", err),
    ).response;
  }
}

/** Optional ledger card for the observability page; never blocks its snapshot.
 *  The source list is read only to scope the ledger to the selected platform,
 *  in parallel with it and off the same cache the snapshot already warmed. */
export async function operatePaymentsRoute(req: Request) {
  try {
    const scope = await batchScope(req);
    if ("response" in scope) return scope.response;
    const requestedPlatform =
      new URL(req.url).searchParams.get("platform") ?? undefined;
    const { projectId } = scope;
    // The ledger read is account-wide for the same reason the observability
    // batch is; the platform scope is applied to its rows, not to the request.
    const [results, projects] = await Promise.all([
      readCache.paymentsBatch.get(
        [scope.githubUserId, requestedPlatform ?? null, projectId ?? null],
        () =>
          scope.client.getUserPayments({
            githubUserId: scope.githubUserId,
            projectId,
          }),
      ),
      scope.platformProjects(),
    ]);
    return NextResponse.json({
      payments: mergedPartnerPayments(
        onPlatform(results, platformProjectIds(projects)),
      ),
    });
  } catch (err) {
    return buildFailures.handle(
      identifyOperateFailure(req, "operate.payments", err),
    ).response;
  }
}

export async function operateAppDetailRoute(req: Request) {
  const params = new URL(req.url).searchParams;
  const applicationId = Number(params.get("applicationId"));
  if (!isValidProjectId(applicationId)) {
    return NextResponse.json(
      { error: "missing or invalid `applicationId`" },
      { status: 400 },
    );
  }

  try {
    const session = await operateSession(req);
    if ("response" in session) return session.response;
    const detail = await readCache.appDetail.get(
      [session.githubUserId, applicationId],
      () =>
        session.client.getBuilderApplicationDetail({
          githubUserId: session.githubUserId,
          applicationId,
        }),
    );
    const projectId = detail.project.id;
    const input = {
      githubUserId: session.githubUserId,
      projectId,
    };
    const [observability, transactionsResult, logsResult, deployments] =
      await Promise.all([
        readCache.observability.get(
          [session.githubUserId, detail.platform, projectId],
          () => session.client.getUserProjectObservability(input),
        ),
        readCache.transactions.get(
          [session.githubUserId, detail.platform, projectId, { limit: 100 }],
          () =>
            session.client.listUserProjectTransactions({
              ...input,
              limit: 100,
            }),
        ),
        readCache.logs.get(
          [session.githubUserId, detail.platform, projectId, { limit: 200 }],
          () => session.client.listUserProjectLogs({ ...input, limit: 200 }),
        ),
        readCache.deployments.get(
          [session.githubUserId, detail.platform, projectId, { limit: 20 }],
          () =>
            session.client.listUserProjectDeployments({ ...input, limit: 20 }),
        ),
      ]);

    return NextResponse.json({
      detail,
      health:
        observability.apps.find((app) => app.applicationId === applicationId) ??
        null,
      transactions: transactionsResult.transactions
        .filter((row) => row.applicationId === applicationId)
        .slice(0, 4),
      logs: logsResult.logs
        .filter((row) => row.applicationId === applicationId)
        .slice(0, 4),
      deployments,
    });
  } catch (err) {
    return buildFailures.handle(
      identifyOperateFailure(req, "operate.app_detail", err),
    ).response;
  }
}
