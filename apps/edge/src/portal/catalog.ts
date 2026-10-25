import type { FetchLike } from "../routing/upstream";

export type PublicCatalogKind = "models" | "apps" | "skills";
const PATHS: Record<PublicCatalogKind, string> = {
  models: "/api/thread/models",
  apps: "/api/thread/apps",
  skills: "/api/resource/skills",
};
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
  const projected: Record<string, string | number | boolean | Array<string | number>> = {};
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
          typeof item === "string" || (typeof item === "number" && Number.isFinite(item)),
      );
  }
  return projected;
}

/** Explicit projection. No account enablement, arbitrary metadata, secrets or installed state. */
export function projectPublicCatalog(kind: PublicCatalogKind, value: unknown): unknown {
  if (kind === "models")
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  if (kind === "apps")
    return (Array.isArray(value) ? value : []).flatMap((item) => {
      const app = row(item);
      return app && app.is_public === true && app.is_active === true && typeof app.name === "string"
        ? [pick(app, APP_FIELDS)]
        : [];
    });
  const skills = row(value)?.skills;
  return {
    skills: (Array.isArray(skills) ? skills : []).flatMap((item) => {
      const skill = row(item);
      return skill && typeof skill.id === "string" && typeof skill.name === "string"
        ? [pick(skill, SKILL_FIELDS)]
        : [];
    }),
  };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function isPublicCatalogKind(kind: string): kind is PublicCatalogKind {
  return Object.hasOwn(PATHS, kind);
}

/** The public catalog: a projected, cacheable read of the backend's thread catalogs. */
export async function publicCatalog(
  request: Request,
  kind: PublicCatalogKind,
  backendOrigin: string,
  fetchImpl: FetchLike,
): Promise<Response> {
  const incoming = new URL(request.url);
  const upstreamUrl = new URL(PATHS[kind], backendOrigin);
  // Only public catalog filters. Never copy account, app key, session, or auth query fields.
  if (kind === "apps")
    for (const platform of incoming.searchParams.getAll("platform"))
      upstreamUrl.searchParams.append("platform", platform);
  if (kind === "skills") upstreamUrl.searchParams.set("limit", "100");
  const upstreamHeaders = new Headers({ accept: "application/json" });
  // The backend's thread extractors require a transport id even for reads.
  // A fresh, edge-owned id selects anonymous public state and cannot reuse a
  // caller's account-bound thread. These routes require no bearer assertion.
  if (kind === "apps" || kind === "models")
    upstreamHeaders.set("x-thread-id", `public-catalog-${crypto.randomUUID()}`);
  let upstream: Response;
  try {
    upstream = await fetchImpl(
      new Request(upstreamUrl, { method: "GET", headers: upstreamHeaders, redirect: "error" }),
      { cache: "no-store" },
    );
  } catch {
    return Response.json({ error: "catalog_unavailable" }, { status: 502, headers: { "cache-control": "no-store" } });
  }
  if (!upstream.ok)
    return Response.json(
      { error: "catalog_unavailable" },
      { status: upstream.status, headers: { "cache-control": "no-store" } },
    );
  const body = JSON.stringify(projectPublicCatalog(kind, await upstream.json()));
  const etag = `"${await sha256Hex(body)}"`;
  const headers = {
    "content-type": "application/json",
    "cache-control": "public, max-age=0, must-revalidate",
    "cdn-cache-control": "public, max-age=1800, stale-while-revalidate=86400",
    etag,
  };
  if (request.headers.get("if-none-match") === etag)
    return new Response(null, { status: 304, headers });
  return new Response(request.method === "HEAD" ? null : body, { status: 200, headers });
}
