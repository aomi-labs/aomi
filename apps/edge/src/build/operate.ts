/**
 * Build's operate family over the manager client: channels, model keys,
 * transactions, usage, logs, observability, payments and the agent detail.
 *
 * Every read is one manager result over the agents the caller's publisher
 * owns, narrowed by the manager to one project (`projectId`) or one agent
 * (`agentId`). Its `projects` are the real projects among those agents.
 */
import type {
  OperateLogCursor,
  OperatePartnerPayments,
  OperateTransactionCursor,
} from "@aomi-labs/deploy";
import {
  caipChainId,
  caipChainLabel,
} from "@aomi-labs/internal/operate-format";
import { z } from "zod";

import { EdgeError } from "../kernel/errors";
import { cursor, id, numeric, text } from "../kernel/route";
import { endpoint, platformSlug, type BuildRoute, type Call } from "./endpoint";

const ops = (name: string) => `/api/build/operate/${name}`;
const CHANNEL = (action: string) =>
  new RegExp(`^/api/build/operate/channels/(?<channelId>[^/]+)/${action}$`);

const scoped = z.object({
  projectId: id.optional(),
  agentId: id.optional(),
});

/** A page size: the fallback when absent or invalid, capped at `max`. */
const pageSize = (fallback: number, max: number) =>
  numeric(z.number().int().positive())
    .transform((value) => Math.min(value, max))
    .catch(fallback);

function scope({ input, session }: Call<z.output<typeof scoped>>) {
  return {
    githubUserId: session.githubUserId,
    projectId: input.projectId,
    agentId: input.agentId,
  };
}

/** A confirmed partner settlement as a row of the transactions table. */
function payoutRow(
  event: OperatePartnerPayments["events"][number],
  payments: OperatePartnerPayments,
) {
  const provider =
    event.paymentMethod.toLowerCase() === "coinbase"
      ? "Coinbase"
      : event.paymentMethod;
  return {
    id: `partner-payout:${event.id}`,
    kind: "partner_payout",
    externalTxId: event.receiptId ?? event.id,
    agent: event.agent ?? "Partner payout",
    agentId: event.agentId,
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
    projectId: null,
    platform: null,
  };
}

const newestFirst = (
  a: { createdAt: number; id: string },
  b: { createdAt: number; id: string },
) => b.createdAt - a.createdAt || b.id.localeCompare(a.id);

const transactions = endpoint(
  "operate.transactions",
  "GET",
  ops("transactions"),
  {
    input: scoped.extend({
      limit: pageSize(50, 100),
      cursor: cursor.optional(),
      status: z.string().optional(),
    }),
    run: async (call) => {
      const { input, client } = call;
      const [page, statement] = await Promise.all([
        client.listUserTransactions({
          ...scope(call),
          limit: input.limit,
          status: input.status,
          cursor: input.cursor as OperateTransactionCursor,
        }),
        // Settlements have no cursor: the whole overlay rides on page one.
        input.cursor === undefined
          ? client.getUserStatements(scope(call))
          : null,
      ]);
      const payouts =
        !statement || (input.status && input.status !== "confirmed")
          ? []
          : statement.payments.events
              .filter((event) => event.kind === "settlement_confirmed")
              .map((event) => payoutRow(event, statement.payments));
      return {
        projects: page.projects,
        transactions: [
          ...page.transactions.map((row) => ({
            ...row,
            kind: "agent_transaction",
          })),
          ...payouts,
        ].sort(newestFirst),
        nextCursor: page.nextCursor,
      };
    },
  },
);

/** Model usage and the builder's statement, which reads `available: false`
 *  when the ledger could not be read and has no entries when it is empty. */
const usage = endpoint("operate.usage", "GET", ops("usage"), {
  input: scoped.extend({
    fromDate: z.string().optional(),
    toDate: z.string().optional(),
  }),
  run: async (call) => {
    const dates = { fromDate: call.input.fromDate, toDate: call.input.toDate };
    const [usage, statement] = await Promise.all([
      call.client.getUserUsage({ ...scope(call), ...dates }),
      call.client.getUserStatements({ ...scope(call), ...dates }),
    ]);
    return {
      projects: usage.projects,
      range: usage.range,
      daily: usage.daily,
      breakdown: usage.breakdown,
      statement,
    };
  },
});

const logs = endpoint("operate.logs", "GET", ops("logs"), {
  input: scoped.extend({
    limit: pageSize(100, 200),
    cursor: cursor.optional(),
    type: z.string().optional(),
  }),
  run: async (call) => {
    const { input, client } = call;
    const page = await client.listUserLogs({
      ...scope(call),
      limit: input.limit,
      type: input.type,
      cursor: input.cursor as OperateLogCursor,
    });
    return {
      projects: page.projects,
      logs: page.logs,
      nextCursor: page.nextCursor,
    };
  },
});

const observability = endpoint(
  "operate.observability",
  "GET",
  ops("observability"),
  {
    input: scoped,
    run: (call) => call.client.getUserObservability(scope(call)),
  },
);

/** The observability page's ledger card, read apart from its snapshot. */
const payments = endpoint("operate.payments", "GET", ops("payments"), {
  input: scoped,
  run: async (call) => ({
    payments: await call.client.getUserPayments(scope(call)),
  }),
});

const agentDetail = endpoint(
  "operate.agent_detail",
  "GET",
  ops("observability/detail"),
  {
    input: z.object({
      agentId: id,
      window: z.enum(["1h", "24h", "7d", "30d"]).default("24h"),
    }),
    run: async ({ input, client, session }) => {
      const { agentId, window } = input;
      const githubUserId = session.githubUserId;
      // The manager proves the agent the caller's publisher's.
      const [detail, health, transactionPage, logPage] = await Promise.all([
        client.getBuilderAgentDetail({ githubUserId, agentId, window }),
        client.getUserObservability({ githubUserId, agentId }),
        client.listUserTransactions({ githubUserId, agentId, limit: 4 }),
        client.listUserLogs({ githubUserId, agentId, limit: 4 }),
      ]);
      const seconds = {
        "1h": 3600,
        "24h": 86400,
        "7d": 604800,
        "30d": 2592000,
      }[window];
      if (detail.windowSeconds !== seconds)
        throw new EdgeError(
          503,
          "This time range is not available on the backend yet.",
        );
      return {
        detail,
        health: health.agents.find((row) => row.agentId === agentId) ?? null,
        transactions: transactionPage.transactions,
        logs: logPage.logs,
        deployments: [],
      };
    },
  },
);

// ── channels ────────────────────────────────────────────────────────────────

/** A channel-level command URL; blank clears it. The manager owns scheme rules. */
const commandUrl = z
  .string()
  .nullable()
  .transform((value) => value?.trim() || null)
  .optional();

/** The agent binding and command config a channel is saved with. Omitted command
 *  fields are omitted from the manager body, which leaves them unchanged. */
const channelBinding = z.object({
  agentId: z.number(),
  miniAppUrl: commandUrl,
  miniAppLabel: commandUrl,
  commandEndpoint: commandUrl,
  commands: z.array(z.string()).optional(),
});

const channels = endpoint("operate.channels_read", "GET", ops("channels"), {
  run: (call) =>
    call.client.listUserChannels({ githubUserId: call.session.githubUserId }),
});

const channelsCreate = endpoint(
  "operate.channels_create",
  "POST",
  ops("channels"),
  {
    auth: { write: true },
    input: channelBinding.extend({
      credential: text,
      label: z.string().optional().catch(undefined),
      threadMode: z.string().optional().catch(undefined),
    }),
    status: 201,
    run: async (call) => {
      const channel = await call.client.createUserChannel({
        githubUserId: call.session.githubUserId,
        kind: "telegram",
        ...call.input,
      });
      return { channel };
    },
  },
);

const channelsUpdate = endpoint(
  "operate.channels_update",
  "PATCH",
  ops("channels"),
  {
    auth: { write: true },
    input: channelBinding.extend({
      channelId: z.string(),
      threadMode: z.enum(["single", "multi"]).optional(),
    }),
    run: async (call) => {
      // The manager re-asserts the Telegram webhook after every save; a failure
      // there is a warning beside the saved channel, not a failed save.
      const { webhookWarning, ...channel } =
        await call.client.updateUserChannel({
          githubUserId: call.session.githubUserId,
          ...call.input,
        });
      return { channel, ...(webhookWarning ? { webhookWarning } : {}) };
    },
  },
);

// The manager enforces channel and agent ownership. The command secret is never
// logged here.
const byChannel = z.object({ channelId: text });

const channelsDelete = endpoint(
  "operate.channels_delete",
  "DELETE",
  ops("channels"),
  {
    auth: { write: true },
    input: byChannel,
    run: async ({ input, client, session }) => {
      await client.deleteUserChannel({
        githubUserId: session.githubUserId,
        ...input,
      });
      return { ok: true };
    },
  },
);

const channelsCommandSecret = endpoint(
  "operate.channels_command_secret",
  "GET",
  CHANNEL("command-secret"),
  {
    input: byChannel,
    run: async ({ input, client, session }) => ({
      commandSecret: (
        await client.revealUserChannelCommandSecret({
          githubUserId: session.githubUserId,
          ...input,
        })
      ).commandSecret,
    }),
  },
);

/** Compare Telegram's registered webhook with the manager's and re-assert it
 *  on a mismatch. Only the comparison and delivery stats come back. */
const channelsWebhook = endpoint(
  "operate.channels_webhook",
  "POST",
  CHANNEL("webhook"),
  {
    auth: { write: true },
    input: byChannel,
    run: async ({ input, client, session }) => ({
      webhook: await client.checkUserChannelWebhook({
        githubUserId: session.githubUserId,
        ...input,
      }),
    }),
  },
);

// ── model keys (the funder ladder's package rung, builder-owned) ───────────

/** Model keys are read and written under one platform, the default unless named. */
const keyed = z.object({ platform: platformSlug.optional() });

function keyScope({ input, session, ctx }: Call<z.output<typeof keyed>>) {
  return {
    githubUserId: session.githubUserId,
    platform: input.platform ?? ctx.config.defaultPlatform,
  };
}

/** The builder's key inventory with grants, plus the agents a key can fund.
 *  Never key material. */
const modelKeys = endpoint(
  "operate.model_keys_read",
  "GET",
  ops("model-keys"),
  {
    input: keyed,
    run: (call) => call.client.listBuilderModelKeys(keyScope(call)),
  },
);

/** Create a key, or with `keyId` rotate one in place. */
const modelKeysSave = endpoint(
  "operate.model_keys_save",
  "POST",
  ops("model-keys"),
  {
    auth: { write: true },
    input: keyed.extend({
      provider: text,
      key: text,
      keyId: z.number().optional(),
      label: z.string().optional().catch(undefined),
    }),
    status: 201,
    run: async (call) => {
      const { provider, key, keyId, label } = call.input;
      return {
        key: await call.client.saveBuilderModelKey({
          ...keyScope(call),
          keyId,
          provider,
          key,
          label,
        }),
      };
    },
  },
);

/** Replace a key's grant set. */
const modelKeysGrants = endpoint(
  "operate.model_keys_grants",
  "PUT",
  ops("model-keys"),
  {
    auth: { write: true },
    input: keyed.extend({
      keyId: z.number(),
      agentIds: z.array(z.number()),
      modelIds: z.union([z.literal("*"), z.array(z.string()).min(1)]),
    }),
    run: async (call) => {
      const { keyId, agentIds, modelIds } = call.input;
      return {
        key: await call.client.setModelKeyGrants({
          ...keyScope(call),
          keyId,
          agentIds,
          modelIds,
        }),
      };
    },
  },
);

const modelKeysDelete = endpoint(
  "operate.model_keys_delete",
  "DELETE",
  ops("model-keys"),
  {
    auth: { write: true },
    input: keyed.extend({ keyId: id }),
    run: async (call) => {
      await call.client.deleteBuilderModelKey({
        ...keyScope(call),
        keyId: call.input.keyId,
      });
      return { ok: true };
    },
  },
);

export const OPERATE_ROUTES: readonly BuildRoute[] = [
  channels,
  channelsCreate,
  channelsUpdate,
  channelsDelete,
  channelsCommandSecret,
  channelsWebhook,
  modelKeys,
  modelKeysSave,
  modelKeysGrants,
  modelKeysDelete,
  transactions,
  usage,
  logs,
  observability,
  payments,
  agentDetail,
];
