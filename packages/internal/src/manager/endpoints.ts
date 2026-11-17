/**
 * Every manager operation, one row each: a function from the caller's input
 * to the request it makes and how the response body reads. The scope helpers
 * (`user`, `project`, `builder`, `platform`) own the path prefix, the
 * `github_user_id` query and the id checks, so a row states only what is its
 * own. Input checks throw `INVALID_REQUEST` before anything is sent.
 */
import { DeployError } from "@aomi-labs/deploy";
import type {
  BuilderAgentKeyInput,
  BuilderChannelsInput,
  BuilderModelKeysInput,
  CheckUserChannelWebhookInput,
  ClaimGitHubProjectInput,
  CreateUserChannelInput,
  DeleteBuilderModelKeyInput,
  DeleteUserChannelInput,
  ExchangeGitHubCodeInput,
  GetBuilderAgentInput,
  GetUserObservabilityInput,
  GetUserProjectInput,
  GetUserProjectUsageInput,
  GetUserStatementsInput,
  ListUserLogsInput,
  ListUserProjectLogsInput,
  ListUserProjectsInput,
  ListUserProjectTransactionsInput,
  ListUserTransactionsInput,
  OperateLogCursor,
  OperateTransactionCursor,
  OwnedOperateProjectInput,
  RevealUserChannelCommandSecretInput,
  SaveBuilderModelKeyInput,
  SetModelKeyGrantsInput,
  UpdateUserChannelInput,
  UpdateUserChannelResult,
} from "@aomi-labs/deploy";
import {
  Channel as ChannelSchema,
  ChannelWebhookStatus,
  BuilderAgentKey as BuilderAgentKeySchema,
  BuilderAgent,
  BuilderModelKey,
  ClaimGitHubProjectResult as ClaimGitHubProjectResultSchema,
  GitHubAppInstallationsResult,
  GitHubIdentity,
  OperateAgentDetailResult,
  OperateLogsResult,
  OperateObservabilityResult,
  OperateObservabilitySnapshot,
  OperatePaymentProjectResult,
  OperateStatementResult,
  OperateTransactionsResult,
  OperateUsageResult,
  UserLogsResult,
  UserProject,
  UserProjectAgentsResult,
  UserTransactionsResult,
  list,
} from "@aomi-labs/deploy/schemas";

import { RELEASE_ENDPOINTS } from "./releases";

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** A response body: the parsed JSON object, or `{}` for anything else. */
export type Raw = Record<string, any>;

type Scalar = string | number | null | undefined;

/** One manager request and how its body reads. */
export type ManagerRequest<O> = {
  /** The operation's name, which labels a `BackendError`. */
  op: string;
  method?: Method;
  path: string;
  /** Query parameters; empty values are left out. */
  query?: Record<string, Scalar>;
  /** The JSON body, or a tar's bytes; a POST, PUT or PATCH without one sends `{}`. */
  body?: unknown;
  headers?: Record<string, string>;
  read: (raw: Raw) => O;
};

type Row<O> = Omit<ManagerRequest<O>, "path">;

const GITHUB_APP = "/api/integrations/github-app";

/** The account-wide `/user/*` routes, narrowed to one project when the input names it. */
function user<O>(
  input: { githubUserId: string; projectId?: number; visibilityGrant?: string },
  suffix: string,
  row: Row<O>,
): ManagerRequest<O> {
  return {
    ...row,
    path: `${GITHUB_APP}/user/${suffix}`,
    query: {
      github_user_id: required(input.githubUserId, "githubUserId"),
      project_id:
        input.projectId === undefined
          ? undefined
          : positive(input.projectId, "projectId"),
      ...row.query,
    },
    headers: { ...grant(input.visibilityGrant), ...row.headers },
  };
}

/** One owned project's `/user/projects/:id/*` routes. */
function project<O>(
  input: { githubUserId: string; projectId: number },
  suffix: string,
  row: Row<O>,
): ManagerRequest<O> {
  const id = positive(input.projectId, "projectId");
  return {
    ...row,
    path: `${GITHUB_APP}/user/projects/${id}${suffix ? `/${suffix}` : ""}`,
    query: {
      github_user_id: required(input.githubUserId, "githubUserId"),
      ...row.query,
    },
  };
}

/** The builder's `/builder/agents/:id/*` routes. */
function agent<O>(
  input: { githubUserId: string; agentId: number },
  suffix: string,
  row: Row<O>,
): ManagerRequest<O> {
  const id = positive(input.agentId, "agentId");
  return {
    ...row,
    path: `${GITHUB_APP}/builder/agents/${id}${suffix ? `/${suffix}` : ""}`,
    query: {
      github_user_id: required(input.githubUserId, "githubUserId"),
      ...row.query,
    },
  };
}

/** The builder's model keys, which the manager reads per platform. */
function keys<O>(
  input: BuilderModelKeysInput,
  suffix: string,
  row: Row<O>,
): ManagerRequest<O> {
  return {
    ...row,
    path: `${GITHUB_APP}/user/model-keys${suffix ? `/${suffix}` : ""}`,
    query: {
      github_user_id: required(input.githubUserId, "githubUserId"),
      platform: required(input.platform, "platform"),
    },
  };
}

function positive(value: unknown, field: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new DeployError(
      "INVALID_REQUEST",
      `${field} must be a positive integer`,
    );
  }
  return id;
}

function segment(value: string | number): string {
  return encodeURIComponent(String(value));
}

function grant(visibilityGrant: string | undefined): Record<string, string> {
  const value = visibilityGrant?.trim();
  return value ? { "X-Aomi-Visibility-Grant": value } : {};
}

/** A positive page size, or nothing. */
function limit(value: number | undefined): number | undefined {
  return value && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function trimmed(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function dates(input: { fromDate?: string; toDate?: string }) {
  return { from_date: trimmed(input.fromDate), to_date: trimmed(input.toDate) };
}

export function required(
  value: string | undefined | null,
  field: string,
): string {
  const clean = value?.trim();
  if (!clean) throw new DeployError("INVALID_REQUEST", `${field} is required`);
  return clean;
}

/** Reads `field` of the body with `schema`; without a field, the whole body. */
function read<O>(
  schema: { parse(value: unknown): O },
  field?: string,
): (raw: Raw) => O {
  return (raw) => schema.parse(field ? raw[field] : raw);
}

/** The manager pages with the cursor it sent, re-encoded as JSON. */
function cursor(
  value:
    | OperateTransactionCursor
    | OperateLogCursor
    | string
    | null
    | undefined,
): string | null {
  if (!value || typeof value === "string") return value || null;
  return JSON.stringify(
    "eventType" in value
      ? {
          occurred_at: value.occurredAt,
          event_type: value.eventType,
          id: value.id,
        }
      : { created_at: value.createdAt, id: value.id },
  );
}

function channelPath(input: { channelId: string }, suffix = ""): string {
  return `channels/${segment(required(input.channelId, "channelId"))}${suffix}`;
}

function channelBody(input: CreateUserChannelInput | UpdateUserChannelInput) {
  return {
    agent_id: input.agentId,
    label: input.label,
    thread_mode: input.threadMode,
    mini_app_url: input.miniAppUrl,
    mini_app_label: input.miniAppLabel,
    command_endpoint: input.commandEndpoint,
    commands: input.commands,
  };
}

export const ENDPOINTS = {
  ...RELEASE_ENDPOINTS,
  exchangeGitHubCode: (input: ExchangeGitHubCodeInput) => ({
    op: "exchange_github_code",
    path: `${GITHUB_APP}/oauth/exchange`,
    query: {
      code: required(input.code, "code"),
      app: input.app,
      redirect_uri: trimmed(input.redirectUri),
    },
    read: read(GitHubIdentity),
  }),
  claimGitHubProject: (input: ClaimGitHubProjectInput) => ({
    op: "claim_github_project",
    method: "POST" as const,
    path: `${GITHUB_APP}/oauth/claim`,
    body: {
      code: required(input.code, "code"),
      project_id: positive(input.projectId, "projectId"),
      redirect_uri: input.redirectUri,
    },
    read: read(ClaimGitHubProjectResultSchema),
  }),
  listUserProjects: (input: ListUserProjectsInput) =>
    user(input, "projects", {
      op: "list_user_projects",
      query: { platform: trimmed(input.platform) },
      read: read(list(UserProject), "projects"),
    }),
  deleteUserProject: (input: GetUserProjectInput) =>
    project(input, "", {
      op: "delete_user_project",
      method: "DELETE",
      read: () => undefined,
    }),
  getUserProject: (input: GetUserProjectInput) =>
    project(input, "", {
      op: "get_user_project",
      headers: grant(input.visibilityGrant),
      read: read(UserProject),
    }),
  listUserGitHubAppInstallations: (input: { githubUserId: string }) =>
    user(input, "installations", {
      op: "list_user_github_app_installations",
      read: read(GitHubAppInstallationsResult),
    }),
  listUserProjectAgents: (input: OwnedOperateProjectInput) =>
    project(input, "agents", {
      op: "list_user_project_agents",
      read: read(UserProjectAgentsResult),
    }),
  getBuilderAgent: (input: GetBuilderAgentInput) =>
    agent(input, "", {
      op: "get_builder_agent",
      read: read(BuilderAgent),
    }),
  getBuilderAgentDetail: (
    input: GetBuilderAgentInput & { window?: "1h" | "24h" | "7d" | "30d" },
  ) =>
    agent(input, "detail", {
      op: "get_builder_agent_detail",
      query: { window: input.window },
      read: read(OperateAgentDetailResult),
    }),
  getBuilderAgentKey: (input: BuilderAgentKeyInput) =>
    agent(input, "agent-key", {
      op: "get_builder_agent_key",
      read: read(BuilderAgentKeySchema, "agent_key"),
    }),
  regenerateBuilderAgentKey: (input: BuilderAgentKeyInput) =>
    agent(input, "agent-key", {
      op: "regenerate_builder_agent_key",
      method: "POST",
      read: (raw) => {
        const key = BuilderAgentKeySchema.parse(raw.agent_key);
        if (!key)
          throw new DeployError(
            "BACKEND",
            "agent key response is missing `agent_key`",
          );
        return key;
      },
    }),
  listUserChannels: (input: BuilderChannelsInput) =>
    user(input, "channels", {
      op: "list_user_bots",
      read: read(list(ChannelSchema), "channels"),
    }),
  createUserChannel: (input: CreateUserChannelInput) =>
    user(input, "channels", {
      op: "create_user_bot",
      method: "POST",
      body: {
        kind: required(input.kind, "kind"),
        credential: required(input.credential, "credential"),
        ...channelBody(input),
      },
      read: read(ChannelSchema, "channel"),
    }),
  updateUserChannel: (input: UpdateUserChannelInput) =>
    user(input, channelPath(input), {
      op: "update_user_bot",
      method: "PATCH",
      body: channelBody(input),
      read: (raw): UpdateUserChannelResult => ({
        ...ChannelSchema.parse(raw.channel),
        ...(typeof raw.webhook_warning === "string" && raw.webhook_warning
          ? { webhookWarning: raw.webhook_warning }
          : {}),
      }),
    }),
  checkUserChannelWebhook: (input: CheckUserChannelWebhookInput) =>
    user(input, channelPath(input, "/webhook"), {
      op: "check_user_bot_webhook",
      method: "POST",
      read: read(ChannelWebhookStatus, "webhook"),
    }),
  revealUserChannelCommandSecret: (
    input: RevealUserChannelCommandSecretInput,
  ) =>
    user(input, channelPath(input, "/command-secret"), {
      op: "reveal_user_bot_command_secret",
      read: (raw) => ({ commandSecret: String(raw.command_secret ?? "") }),
    }),
  deleteUserChannel: (input: DeleteUserChannelInput) =>
    user(input, channelPath(input), {
      op: "delete_user_bot",
      method: "DELETE",
      read: () => undefined,
    }),
  listBuilderModelKeys: (input: BuilderModelKeysInput) =>
    keys(input, "", {
      op: "list_builder_model_keys",
      read: read(list(BuilderModelKey), "keys"),
    }),
  saveBuilderModelKey: (input: SaveBuilderModelKeyInput) =>
    keys(input, input.keyId === undefined ? "" : segment(input.keyId), {
      op: "save_builder_model_key",
      method: input.keyId === undefined ? "POST" : "PUT",
      body: {
        provider: required(input.provider, "provider"),
        key: required(input.key, "key"),
        label: input.label,
      },
      read: read(BuilderModelKey, "key"),
    }),
  deleteBuilderModelKey: (input: DeleteBuilderModelKeyInput) =>
    keys(input, segment(positive(input.keyId, "keyId")), {
      op: "delete_builder_model_key",
      method: "DELETE",
      read: () => undefined,
    }),
  setModelKeyGrants: (input: SetModelKeyGrantsInput) =>
    keys(input, `${positive(input.keyId, "keyId")}/grants`, {
      op: "set_model_key_grants",
      method: "PUT",
      body: { agent_ids: input.agentIds, model_ids: input.modelIds },
      read: read(BuilderModelKey, "key"),
    }),
  listUserProjectTransactions: (input: ListUserProjectTransactionsInput) =>
    project(input, "transactions", {
      op: "list_user_project_transactions",
      query: {
        limit: limit(input.limit),
        status: trimmed(input.status),
        cursor: cursor(input.cursor),
      },
      read: read(OperateTransactionsResult),
    }),
  getUserProjectUsage: (input: GetUserProjectUsageInput) =>
    project(input, "usage", {
      op: "get_user_project_usage",
      query: dates(input),
      read: read(OperateUsageResult),
    }),
  getUserProjectStatement: (input: GetUserProjectUsageInput) =>
    project(input, "statement", {
      op: "get_user_project_statement",
      query: dates(input),
      read: read(OperateStatementResult),
    }),
  listUserProjectLogs: (input: ListUserProjectLogsInput) =>
    project(input, "logs", {
      op: "list_user_project_logs",
      query: {
        limit: limit(input.limit),
        type: trimmed(input.type),
        cursor: cursor(input.cursor),
      },
      read: read(OperateLogsResult),
    }),
  getUserProjectObservability: (input: OwnedOperateProjectInput) =>
    project(input, "observability", {
      op: "get_user_project_observability",
      read: read(OperateObservabilityResult),
    }),
  getUserObservability: (input: GetUserObservabilityInput) =>
    user(input, "observability", {
      op: "get_user_observability",
      read: read(list(OperateObservabilitySnapshot), "results"),
    }),
  getUserPayments: (input: GetUserObservabilityInput) =>
    user(input, "payments", {
      op: "get_user_payments",
      read: read(list(OperatePaymentProjectResult), "results"),
    }),
  listUserTransactions: (input: ListUserTransactionsInput) =>
    user(input, "transactions", {
      op: "list_user_transactions",
      query: {
        limit: limit(input.limit),
        status: trimmed(input.status),
        cursor: cursor(input.cursor),
      },
      read: read(UserTransactionsResult),
    }),
  getUserStatements: (input: GetUserStatementsInput) =>
    user(input, "statement", {
      op: "get_user_statement",
      query: dates(input),
      read: read(list(OperateStatementResult), "results"),
    }),
  getUserUsage: (input: GetUserStatementsInput) =>
    user(input, "usage", {
      op: "get_user_usage",
      query: dates(input),
      read: read(list(OperateUsageResult), "results"),
    }),
  listUserLogs: (input: ListUserLogsInput) =>
    user(input, "logs", {
      op: "list_user_logs",
      query: {
        limit: limit(input.limit),
        type: trimmed(input.type),
        cursor: cursor(input.cursor),
      },
      read: read(UserLogsResult),
    }),
} satisfies Record<string, (input: never) => ManagerRequest<unknown>>;

export type Endpoints = typeof ENDPOINTS;
