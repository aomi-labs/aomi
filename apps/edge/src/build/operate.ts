/**
 * Build's operate family over the manager client: bots, model keys,
 * transactions, usage, logs, observability, payments and the app detail.
 *
 * A view is either one project (`projectId`, proven the caller's, read through
 * the per-project endpoints under the project's own platform) or the whole
 * account (the manager's batch endpoints, narrowed to the selected platform's
 * projects). The project list is started beside a view's own reads, never
 * ahead of them.
 */
import type {
  OperateLogCursor,
  OperatePartnerPayments,
  OperatePaymentProjectResult,
  OperateStatementResult,
  OperateTransactionCursor,
  OperateUsageResult,
  UserProject,
} from "@aomi-labs/deploy";
import { EXAMPLE_PROJECT, exampleStatement } from "@aomi-labs/internal/operate-fixtures/wire";
import { caipChainId, caipChainLabel, creditsToUsd } from "@aomi-labs/internal/operate-format";
import { z } from "zod";

import { EdgeError } from "../kernel/errors";
import { cursor, id, numeric, text } from "../kernel/route";
import { endpoint, notFound, type BuildRoute, type Call } from "./endpoint";
import { reportFailure } from "./failures";
import { platformSlug } from "./endpoint";

const ops = (name: string) => `/api/build/operate/${name}`;
const BOT = (action: string) => new RegExp(`^/api/build/operate/bots/(?<botId>[^/]+)/${action}$`);

const scoped = z.object({ platform: platformSlug.optional(), projectId: id.optional() });
type Scoped = z.output<typeof scoped>;

/** A page size: the fallback when absent or invalid, capped at `max`. */
const pageSize = (fallback: number, max: number) =>
  numeric(z.number().int().positive())
    .transform((value) => Math.min(value, max))
    .catch(fallback);

type View = {
  githubUserId: string;
  platform: string;
  /** Set for a one-project view. */
  projectId?: number;
  /** Starts the view's project list; call it beside the view's own reads. */
  projects: () => Promise<UserProject[]>;
};

function listProjects({ client, session, visibilityGrant }: Call<unknown>, platform?: string) {
  return client.listUserProjects({
    githubUserId: session.githubUserId,
    platform,
    visibilityGrant: visibilityGrant ?? undefined,
  });
}

/**
 * The projects a view covers. `account` lists every project the caller owns
 * (bots and model keys pick from all of them); otherwise the selected
 * platform's, the exact list behind `/projects`.
 */
async function view(call: Call<Scoped>, account = false): Promise<View> {
  const { input, session, ctx } = call;
  const githubUserId = session.githubUserId;
  if (input.projectId === undefined) {
    const selected = input.platform ?? ctx.config.defaultPlatform;
    return { githubUserId, platform: selected, projects: () => listProjects(call, account ? undefined : selected) };
  }
  const project = (await listProjects(call)).find((candidate) => candidate.id === input.projectId);
  if (!project) throw notFound("project not found for this user");
  return { githubUserId, platform: project.platformName, projectId: project.id, projects: async () => [project] };
}

/** Rows on the view's projects; rows with no project (account-level partner settlements) are on every view. */
function onProjects<T extends { project?: { id: number } | null }>(rows: T[], projects: UserProject[]): T[] {
  const ids = new Set(projects.map((project) => project.id));
  return rows.filter((row) => !row.project || ids.has(row.project.id));
}

/** Batch rows carry a project id; give them the project the batch describes. */
function withProjects<P extends { id: number }, T extends { projectId?: number | null; platform?: string | null }>(
  batch: { projects: Array<{ project: P }> },
  rows: T[],
  fallbackPlatform: string,
) {
  const byId = new Map(batch.projects.map((ref) => [ref.project.id, ref.project]));
  return rows.map(({ projectId, platform, ...row }) => ({
    ...row,
    project: (projectId != null ? byId.get(projectId) : undefined) ?? null,
    platform: platform ?? fallbackPlatform,
  }));
}

/** Tag each row of a per-project result with its project and platform. */
function tagged<R>(result: { project: unknown; platform: string }, rows: R[]) {
  return rows.map((row) => ({ ...row, project: result.project as UserProject, platform: result.platform }));
}

type Dates = { fromDate?: string; toDate?: string };

/** The view's statements. A project without one (no statement entries on its
 *  backend yet) has none rather than failing the view. */
function statements({ client, request }: Call<unknown>, scope: View, dates: Dates = {}): Promise<OperateStatementResult[]> {
  const { githubUserId, projectId } = scope;
  if (projectId === undefined) return client.getUserStatements({ githubUserId, ...dates });
  return client.getUserProjectStatement({ githubUserId, projectId, ...dates }).then(
    (one) => [one],
    (error: unknown) => {
      reportFailure(error, request, "operate.statement");
      return [];
    },
  );
}

function mergedPartnerPayments(
  rows: Array<{ project: OperatePaymentProjectResult["project"]; payments: OperatePartnerPayments }>,
) {
  const sum = (pick: (summary: OperatePartnerPayments["summary"]) => number) =>
    rows.reduce((total, row) => total + pick(row.payments.summary), 0);
  const eventById = new Map<
    string,
    OperatePartnerPayments["events"][number] & { project: OperatePaymentProjectResult["project"] }
  >();
  for (const row of rows) {
    for (const event of row.payments.events) {
      const key = `${event.kind}:${event.id}`;
      const existing = eventById.get(key);
      if (!existing) {
        eventById.set(key, { ...event, project: row.project });
      } else if (existing.applicationId !== event.applicationId) {
        // A recipient-bucket settlement can clear fees for apps in several
        // projects; it belongs to the beneficiary, not the first project merged.
        existing.application = null;
        existing.applicationId = null;
      }
    }
  }
  const events = [...eventById.values()].sort((a, b) => b.occurredAt - a.occurredAt || b.id.localeCompare(a.id));
  const buckets = [
    ...new Map(rows.flatMap((row) => row.payments.buckets.map((bucket) => [bucket.id, bucket]))).values(),
  ];
  const settlements = events.filter((event) => event.kind === "settlement_confirmed");
  const outstandingCredits = buckets.reduce((total, bucket) => total + bucket.outstandingCredits, 0);
  return {
    available: rows.some((row) => row.payments.available),
    scope: "recipient_bucket",
    summary: {
      accruedCredits: sum((summary) => summary.accruedCredits),
      accruedUsd: sum((summary) => summary.accruedUsd),
      settledCredits: settlements.reduce((total, event) => total + event.credits, 0),
      settledUsd: settlements.reduce((total, event) => total + event.usd, 0),
      outstandingCredits,
      outstandingUsd: creditsToUsd(outstandingCredits),
      pricedCalls: sum((summary) => summary.pricedCalls),
      settlements: settlements.length,
    },
    resources: rows.flatMap((row) => row.payments.resources.map((resource) => ({ ...resource, project: row.project }))),
    buckets,
    events,
  };
}

type MergedPayments = ReturnType<typeof mergedPartnerPayments>;

const statementPayments = (rows: OperateStatementResult[]) =>
  mergedPartnerPayments(rows.map((row) => ({ project: row.project as UserProject, payments: row.payments })));

/** A confirmed partner settlement as a row of the transactions table. */
function payoutRow(event: MergedPayments["events"][number], payments: MergedPayments, platformName: string) {
  const provider = event.paymentMethod.toLowerCase() === "coinbase" ? "Coinbase" : event.paymentMethod;
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
    payment: { credits: event.credits, recipient: event.recipient, scope: payments.scope },
    project: event.project,
    platform: platformName,
  };
}

const newestFirst = (a: { createdAt: number; id: string }, b: { createdAt: number; id: string }) =>
  b.createdAt - a.createdAt || b.id.localeCompare(a.id);

const transactions = endpoint("operate.transactions", "GET", ops("transactions"), {
  input: scoped.extend({ limit: pageSize(50, 100), cursor: cursor.optional(), status: z.string().optional() }),
  run: async (call) => {
    const { input, client } = call;
    const scope = await view(call);
    const { githubUserId, projectId } = scope;
    const page = { limit: input.limit, status: input.status, cursor: input.cursor as OperateTransactionCursor };
    const [projects, rows, statementRows] = await Promise.all([
      scope.projects(),
      projectId === undefined
        ? client.listUserTransactions({ githubUserId, ...page }).then((batch) => ({
            rows: withProjects(batch, batch.transactions, scope.platform),
            nextCursor: batch.nextCursor,
          }))
        : client.listUserProjectTransactions({ githubUserId, projectId, ...page }).then((result) => ({
            rows: tagged(result, result.transactions),
            nextCursor: result.nextCursor,
          })),
      // Settlements have no cursor: the whole overlay rides on page one.
      input.cursor === undefined ? statements(call, scope) : [],
    ]);
    const payments = statementPayments(onProjects(statementRows, projects));
    const payouts =
      input.status && input.status !== "confirmed"
        ? []
        : payments.events
            .filter((event) => event.kind === "settlement_confirmed")
            .map((event) => payoutRow(event, payments, scope.platform));
    const appTransactions = onProjects(rows.rows, projects).map((row) => ({ ...row, kind: "app_transaction" }));
    return {
      projects,
      transactions: [...appTransactions, ...payouts].sort(newestFirst),
      nextCursor: rows.nextCursor ?? null,
    };
  },
});

const usage = endpoint("operate.usage", "GET", ops("usage"), {
  input: scoped.extend({ fromDate: z.string().optional(), toDate: z.string().optional() }),
  run: async (call) => {
    const { input, client } = call;
    const scope = await view(call);
    const { githubUserId, projectId } = scope;
    const dates = { fromDate: input.fromDate, toDate: input.toDate };
    const [projects, usageRows, statementRows] = await Promise.all([
      scope.projects(),
      projectId === undefined
        ? client.getUserUsage({ githubUserId, ...dates })
        : client.getUserProjectUsage({ githubUserId, projectId, ...dates }).then((one): OperateUsageResult[] => [one]),
      statements(call, scope, dates),
    ]);
    const results = onProjects(usageRows, projects);
    // A backend without statement entries reports `available: false`; until
    // it has them the example statement (flagged `example: true`) stands in.
    const available = onProjects(statementRows, projects).filter((statement) => statement.available);
    const sum = (pick: (statement: OperateStatementResult) => number) =>
      available.reduce((total, statement) => total + pick(statement), 0);
    const perProject = <R>(rows: (statement: OperateStatementResult) => R[]) =>
      available.flatMap((statement) => rows(statement).map((row) => ({ ...row, project: statement.project })));
    return {
      projects,
      range: results[0]?.range ?? null,
      daily: results.flatMap((result) => tagged(result, result.daily)),
      breakdown: results.flatMap((result) => tagged(result, result.breakdown)),
      example: available.length ? undefined : true,
      statement: available.length
        ? {
            range: available[0].range,
            summary: {
              grossRevenue: sum((s) => s.summary.grossRevenue),
              platformFees: sum((s) => s.summary.platformFees),
              serviceCharges: sum((s) => s.summary.serviceCharges),
              net: sum((s) => s.summary.net),
            },
            revenue: perProject((s) => s.revenue),
            charges: perProject((s) => s.charges),
            entries: perProject((s) => s.entries).sort(
              (a, b) => b.day.localeCompare(a.day) || a.application.localeCompare(b.application),
            ),
            payments: statementPayments(available),
          }
        : exampleStatement(projects[0] ?? EXAMPLE_PROJECT),
    };
  },
});

const logs = endpoint("operate.logs", "GET", ops("logs"), {
  input: scoped.extend({ limit: pageSize(100, 200), cursor: cursor.optional(), type: z.string().optional() }),
  run: async (call) => {
    const { input, client } = call;
    const scope = await view(call);
    const { githubUserId, projectId } = scope;
    const page = { limit: input.limit, type: input.type, cursor: input.cursor as OperateLogCursor };
    // The batch stream arrives merged, deduplicated and paginated by one cursor.
    const [projects, rows] = await Promise.all([
      scope.projects(),
      projectId === undefined
        ? client.listUserLogs({ githubUserId, ...page }).then((batch) => ({
            rows: withProjects(batch, batch.logs, scope.platform),
            nextCursor: batch.nextCursor,
          }))
        : client.listUserProjectLogs({ githubUserId, projectId, ...page }).then((result) => ({
            rows: tagged(result, result.logs),
            nextCursor: result.nextCursor,
          })),
    ]);
    return { projects, logs: onProjects(rows.rows, projects), nextCursor: rows.nextCursor ?? null };
  },
});

const observability = endpoint("operate.observability", "GET", ops("observability"), {
  input: scoped,
  run: async (call) => {
    const scope = await view(call);
    // One account-wide read: the manager resolves each project under its own
    // bound platform, and the selected platform's projects narrow it here.
    const [projects, snapshots] = await Promise.all([
      scope.projects(),
      call.client.getUserObservability({ githubUserId: scope.githubUserId, projectId: scope.projectId }),
    ]);
    const shown = onProjects(snapshots, projects);
    const healthy = shown.filter((result) => result.monitoring?.status === "ok").length;
    return {
      projects,
      scope: "owned_applications",
      monitoring: {
        provider: "grafana_prometheus",
        status: healthy
          ? healthy < shown.length
            ? "partial"
            : "ok"
          : (shown[0]?.monitoring?.status ?? "unconfigured"),
        windowSeconds: shown[0]?.monitoring?.windowSeconds ?? 0,
      },
      apps: shown.flatMap((result) => tagged(result, result.apps)),
      dashboardLinks: shown.flatMap((result) => result.dashboardLinks),
      platformMetrics: shown[0]?.platformMetrics ?? [],
    };
  },
});

/** The observability page's ledger card, read apart from its snapshot. */
const payments = endpoint("operate.payments", "GET", ops("payments"), {
  input: scoped,
  run: async (call) => {
    const scope = await view(call);
    const [projects, results] = await Promise.all([
      scope.projects(),
      call.client.getUserPayments({ githubUserId: scope.githubUserId, projectId: scope.projectId }),
    ]);
    return { payments: mergedPartnerPayments(onProjects(results, projects)) };
  },
});

const appDetail = endpoint("operate.app_detail", "GET", ops("observability/detail"), {
  input: z.object({ applicationId: id }),
  run: async ({ input, client, session }) => {
    const { applicationId } = input;
    const githubUserId = session.githubUserId;
    // The application names its project; the manager proves it the caller's.
    const detail = await client.getBuilderApplicationDetail({ githubUserId, applicationId });
    const project = { githubUserId, projectId: detail.project.id };
    const [health, transactionPage, logPage, deployments] = await Promise.all([
      client.getUserProjectObservability(project),
      client.listUserProjectTransactions({ ...project, limit: 100 }),
      client.listUserProjectLogs({ ...project, limit: 200 }),
      client.listUserProjectDeployments({ ...project, limit: 20 }),
    ]);
    const mine = <T extends { applicationId?: number | null }>(rows: T[]) =>
      rows.filter((row) => row.applicationId === applicationId).slice(0, 4);
    return {
      detail,
      health: health.apps.find((app) => app.applicationId === applicationId) ?? null,
      transactions: mine(transactionPage.transactions),
      logs: mine(logPage.logs),
      deployments,
    };
  },
});

// ── bots ────────────────────────────────────────────────────────────────

const unique = (ids: number[]) => new Set(ids).size === ids.length;

/** A bot-level command URL; blank clears it. The manager owns scheme rules. */
const commandUrl = z
  .string()
  .nullable()
  .transform((value) => value?.trim() || null)
  .optional();

/** The app mapping and command config a bot is saved with. Omitted command
 *  fields are omitted from the manager body, which leaves them unchanged. */
const botMapping = z.object({
  applicationIds: z.array(z.number()).min(1).refine(unique, "`applicationIds` must be unique"),
  handoverApplicationId: z.number(),
  miniAppUrl: commandUrl,
  miniAppLabel: commandUrl,
  commandEndpoint: commandUrl,
  commands: z.array(z.string()).optional(),
});

/** 403 unless every mapped app is in one of the caller's projects. */
async function requireOwnedApps(call: Call<z.output<typeof botMapping>>): Promise<void> {
  const { applicationIds, handoverApplicationId } = call.input;
  const owned = new Set((await listProjects(call)).flatMap((project) => (project.apps ?? []).map((app) => app.id)));
  if (!applicationIds.every((appId) => owned.has(appId)) || !applicationIds.includes(handoverApplicationId))
    throw new EdgeError(403, "selected apps are not owned by this user");
}

const bots = endpoint("operate.bots_read", "GET", ops("bots"), {
  run: async (call) => {
    const [projects, list] = await Promise.all([
      listProjects(call),
      call.client.listUserBots({ githubUserId: call.session.githubUserId }),
    ]);
    return { projects, bots: list };
  },
});

const botsCreate = endpoint("operate.bots_create", "POST", ops("bots"), {
  auth: { write: true },
  input: botMapping.extend({
    credential: text,
    label: z.string().optional().catch(undefined),
    threadMode: z.string().optional().catch(undefined),
  }),
  status: 201,
  run: async (call) => {
    await requireOwnedApps(call);
    const bot = await call.client.createUserBot({
      githubUserId: call.session.githubUserId,
      botPlatform: "telegram",
      ...call.input,
    });
    return { bot };
  },
});

const botsUpdate = endpoint("operate.bots_update", "PATCH", ops("bots"), {
  auth: { write: true },
  input: botMapping.extend({ botId: z.string(), threadMode: z.enum(["single", "multi"]).optional() }),
  run: async (call) => {
    await requireOwnedApps(call);
    // The manager re-asserts the Telegram webhook after every save; a failure
    // there is a warning beside the saved bot, not a failed save.
    const { webhookWarning, ...bot } = await call.client.updateUserBot({
      githubUserId: call.session.githubUserId,
      ...call.input,
    });
    return { bot, ...(webhookWarning ? { webhookWarning } : {}) };
  },
});

// The remaining bot routes need only the caller: the manager enforces bot
// ownership by builder id. The command secret is never logged here.
const byBot = z.object({ botId: text });

const botsDelete = endpoint("operate.bots_delete", "DELETE", ops("bots"), {
  auth: { write: true },
  input: byBot,
  run: async ({ input, client, session }) => {
    await client.deleteUserBot({ githubUserId: session.githubUserId, ...input });
    return { ok: true };
  },
});

const botsCommandSecret = endpoint("operate.bots_command_secret", "GET", BOT("command-secret"), {
  input: byBot,
  run: async ({ input, client, session }) => ({
    commandSecret: (await client.revealUserBotCommandSecret({ githubUserId: session.githubUserId, ...input }))
      .commandSecret,
  }),
});

/** Compare Telegram's registered webhook with the manager's and re-assert it
 *  on a mismatch. Only the comparison and delivery stats come back. */
const botsWebhook = endpoint("operate.bots_webhook", "POST", BOT("webhook"), {
  auth: { write: true },
  input: byBot,
  run: async ({ input, client, session }) => ({
    webhook: await client.checkUserBotWebhook({ githubUserId: session.githubUserId, ...input }),
  }),
});

// ── model keys (the funder ladder's app rung, builder-owned) ───────────

/** The builder's key inventory with grants, plus their projects for the
 *  "apply to projects" picker. Never key material. */
const modelKeys = endpoint("operate.model_keys_read", "GET", ops("model-keys"), {
  input: scoped,
  run: async (call) => {
    const scope = await view(call, true);
    const [projects, keys] = await Promise.all([
      scope.projects(),
      call.client.listBuilderModelKeys({ githubUserId: scope.githubUserId, platform: scope.platform }),
    ]);
    return { projects, keys };
  },
});

/** Create a key, or with `keyId` rotate one in place. */
const modelKeysSave = endpoint("operate.model_keys_save", "POST", ops("model-keys"), {
  auth: { write: true },
  input: scoped.extend({
    provider: text,
    key: text,
    keyId: z.number().optional(),
    label: z.string().optional().catch(undefined),
  }),
  status: 201,
  run: async (call) => {
    const { githubUserId, platform: selected } = await view(call, true);
    const { provider, key, keyId, label } = call.input;
    return {
      key: await call.client.saveBuilderModelKey({ githubUserId, platform: selected, keyId, provider, key, label }),
    };
  },
});

/** Replace a key's grant set. */
const modelKeysGrants = endpoint("operate.model_keys_grants", "PUT", ops("model-keys"), {
  auth: { write: true },
  input: scoped.extend({
    keyId: z.number(),
    applicationIds: z.array(z.number()),
    modelIds: z.union([z.literal("*"), z.array(z.string()).min(1)]),
  }),
  run: async (call) => {
    const { githubUserId, platform: selected } = await view(call, true);
    const { keyId, applicationIds, modelIds } = call.input;
    return {
      key: await call.client.setModelKeyGrants({ githubUserId, platform: selected, keyId, applicationIds, modelIds }),
    };
  },
});

const modelKeysDelete = endpoint("operate.model_keys_delete", "DELETE", ops("model-keys"), {
  auth: { write: true },
  input: scoped.extend({ keyId: id }),
  run: async (call) => {
    const { githubUserId, platform: selected } = await view(call, true);
    await call.client.deleteBuilderModelKey({ githubUserId, platform: selected, keyId: call.input.keyId });
    return { ok: true };
  },
});

export const OPERATE_ROUTES: readonly BuildRoute[] = [
  bots,
  botsCreate,
  botsUpdate,
  botsDelete,
  botsCommandSecret,
  botsWebhook,
  modelKeys,
  modelKeysSave,
  modelKeysGrants,
  modelKeysDelete,
  transactions,
  usage,
  logs,
  observability,
  payments,
  appDetail,
];
