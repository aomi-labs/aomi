import "@tanstack/react-start/server-only";

import type { BotRegistration } from "@aomi-labs/deploy";
import { buildFailures } from "@/server/bff/failures";
import { identifyOperateFailure, ownedSources } from "./scope";

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
  | { response: Response } {
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
      response: Response.json(
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

export async function operateBotsRoute(req: Request) {
  const owned = await ownedSources(req);
  if ("response" in owned) return owned.response;
  try {
    const bots = await owned.client.listUserBots({
      githubUserId: owned.githubUserId,
    });
    return Response.json({
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
    return Response.json(
      { error: "missing or invalid app mappings" },
      { status: 400 },
    );
  }
  const commandConfig = botCommandConfig(body);
  if ("response" in commandConfig) return commandConfig.response;
  if (typeof body.credential !== "string" || !body.credential.trim()) {
    return Response.json({ error: "missing `credential`" }, { status: 400 });
  }
  const allowedApplicationIds = new Set(
    owned.projects.flatMap((source) =>
      (source.apps ?? []).map((app) => app.id),
    ),
  );
  const applicationIds = body.applicationIds as number[];
  if (new Set(applicationIds).size !== applicationIds.length) {
    return Response.json(
      { error: "`applicationIds` must be unique" },
      { status: 400 },
    );
  }
  if (
    !applicationIds.every((id) => allowedApplicationIds.has(id)) ||
    !applicationIds.includes(body.handoverApplicationId)
  ) {
    return Response.json(
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
    return Response.json({ bot }, { status: 201 });
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
    return Response.json({ error: "missing `botId`" }, { status: 400 });
  }
  try {
    await owned.client.deleteUserBot({
      githubUserId: owned.githubUserId,
      botId,
    });
    return Response.json({ ok: true });
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
    return Response.json(
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
    return Response.json({ error: "invalid `threadMode`" }, { status: 400 });
  }
  const allowed = new Set(
    owned.projects.flatMap((source) =>
      (source.apps ?? []).map((app) => app.id),
    ),
  );
  const applicationIds = body.applicationIds as number[];
  if (new Set(applicationIds).size !== applicationIds.length) {
    return Response.json(
      { error: "`applicationIds` must be unique" },
      { status: 400 },
    );
  }
  if (
    !applicationIds.every((id) => allowed.has(id)) ||
    !applicationIds.includes(body.handoverApplicationId)
  ) {
    return Response.json(
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
    return Response.json({
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
    return Response.json({ error: "missing `botId`" }, { status: 400 });
  }
  try {
    const { commandSecret } = await owned.client.revealUserBotCommandSecret({
      githubUserId: owned.githubUserId,
      botId,
    });
    return Response.json(
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
    return Response.json({ error: "missing `botId`" }, { status: 400 });
  }
  try {
    const webhook = await owned.client.checkUserBotWebhook({
      githubUserId: owned.githubUserId,
      botId,
    });
    return Response.json(
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
