import { createHash, randomUUID } from "node:crypto";
import { backendUrl } from "@/server/env";
import { portalFailures } from "@/server/bff/failures";

export type PublicCatalogKind = "models" | "apps" | "skills";
const PATHS = {
  models: "/api/thread/models",
  apps: "/api/thread/apps",
  skills: "/api/resource/skills",
} as const;
const APP_FIELDS = [
  "name",
  "label",
  "application_id",
  "platform",
  "app_release_tag",
  "feature_catalog",
  "chain_ids",
  "is_public",
  "is_active",
];
const SKILL_FIELDS = [
  "id",
  "name",
  "description",
  "tags",
  "feature_catalog",
  "chain_ids",
  "injected_tools",
  "est_tokens",
];
function row(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function pick(source: Record<string, unknown>, fields: readonly string[]) {
  const projected: Record<
    string,
    string | number | boolean | Array<string | number>
  > = {};
  for (const field of fields) {
    const value = source[field];
    if (
      typeof value === "string" ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    )
      projected[field] = value;
    else if (Array.isArray(value))
      projected[field] = value.filter(
        (item): item is string | number =>
          typeof item === "string" ||
          (typeof item === "number" && Number.isFinite(item)),
      );
  }
  return projected;
}

/** Explicit projection. No account enablement, arbitrary metadata, secrets or installed state. */
export function projectPublicCatalog(
  kind: PublicCatalogKind,
  value: unknown,
): unknown {
  if (kind === "models")
    return Array.isArray(value)
      ? value.filter((item) => typeof item === "string")
      : [];
  if (kind === "apps")
    return (Array.isArray(value) ? value : []).flatMap((item) => {
      const app = row(item);
      return app &&
        app.is_public === true &&
        app.is_active === true &&
        typeof app.name === "string"
        ? [pick(app, APP_FIELDS)]
        : [];
    });
  const skills = row(value)?.skills;
  return {
    skills: (Array.isArray(skills) ? skills : []).flatMap((item) => {
      const skill = row(item);
      return skill &&
        typeof skill.id === "string" &&
        typeof skill.name === "string"
        ? [pick(skill, SKILL_FIELDS)]
        : [];
    }),
  };
}

export async function publicCatalog(
  request: Request,
  kind: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (!Object.hasOwn(PATHS, kind) || request.method !== "GET")
    return Response.json({ error: "not_found" }, { status: 404 });
  const catalog = kind as PublicCatalogKind;
  const incoming = new URL(request.url);
  const upstreamUrl = new URL(PATHS[catalog], backendUrl());
  // Only public catalog filters. Never copy account, app key, session, or auth query fields.
  if (catalog === "apps")
    for (const platform of incoming.searchParams.getAll("platform"))
      upstreamUrl.searchParams.append("platform", platform);
  if (catalog === "skills") upstreamUrl.searchParams.set("limit", "100");
  const upstreamHeaders = new Headers({ accept: "application/json" });
  // The backend's thread extractors require a transport id even for reads.
  // A fresh, server-owned id selects anonymous public state and cannot reuse a
  // caller's account-bound thread. These routes require no bearer assertion.
  if (catalog === "apps" || catalog === "models")
    upstreamHeaders.set("x-thread-id", `public-catalog-${randomUUID()}`);
  try {
    const upstream = await fetchImpl(upstreamUrl, {
      method: "GET",
      headers: upstreamHeaders,
      credentials: "omit",
      redirect: "error",
      signal: request.signal,
    });
    if (!upstream.ok)
      return Response.json(
        { error: "catalog_unavailable" },
        {
          status: upstream.status,
          headers: { "cache-control": "no-store" },
        },
      );
    const body = JSON.stringify(
      projectPublicCatalog(catalog, await upstream.json()),
    );
    const etag = '"' + createHash("sha256").update(body).digest("hex") + '"';
    const headers = {
      "content-type": "application/json",
      "cache-control": "public, max-age=0, must-revalidate",
      "cdn-cache-control": "public, max-age=1800, stale-while-revalidate=86400",
      "vercel-cdn-cache-control":
        "public, max-age=1800, stale-while-revalidate=86400",
      etag,
    };
    return new Response(
      request.headers.get("if-none-match") === etag ? null : body,
      {
        status: request.headers.get("if-none-match") === etag ? 304 : 200,
        headers,
      },
    );
  } catch (error) {
    const response = portalFailures.handle({
      source: "local",
      error,
      response: { status: 502, error: "catalog_unavailable" },
      context: { routeFamily: "/api/public/catalog", operation: catalog },
    }).response;
    response.headers.set("cache-control", "no-store");
    return response;
  }
}
