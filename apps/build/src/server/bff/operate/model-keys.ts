import "@tanstack/react-start/server-only";

import { buildFailures } from "@/server/bff/failures";
import { identifyOperateFailure, ownedSources } from "./scope";

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
    return Response.json({ projects: owned.projects, keys });
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
    return Response.json({ error: "missing `provider`" }, { status: 400 });
  }
  if (typeof body.key !== "string" || !body.key.trim()) {
    return Response.json({ error: "missing `key`" }, { status: 400 });
  }
  if (body.keyId !== undefined && typeof body.keyId !== "number") {
    return Response.json({ error: "invalid `keyId`" }, { status: 400 });
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
    return Response.json({ key }, { status: 201 });
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
    return Response.json(
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
    return Response.json({ key });
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
    return Response.json(
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
    return Response.json({ ok: true });
  } catch (err) {
    return buildFailures.handle(
      identifyOperateFailure(req, "operate.model_keys_delete", err),
    ).response;
  }
}
