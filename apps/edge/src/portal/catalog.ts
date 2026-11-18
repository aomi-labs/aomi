import { sha256Hex } from "../kernel/crypto";
import type { EdgeEnv } from "../env";
import { rankedPool } from "../kernel/pool";
import type { FetchLike } from "../kernel/proxy";

export type PublicCatalogKind = "models" | "toolsets" | "skills" | "packages";
const PATHS: Record<PublicCatalogKind, string> = {
  models: "/api/thread/models",
  toolsets: "/api/resource/toolsets",
  skills: "/api/resource/skills",
  packages: "/api/resource/packages",
};
const TOOLSET_FIELDS = ["name", "display_name"];
const PACKAGE_FIELDS = [
  "id",
  "display_name",
  "description",
  "icon_url",
  "families",
  "tool_count",
  "verified",
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
  if (kind === "toolsets") {
    const toolsets = row(value)?.toolsets;
    return (Array.isArray(toolsets) ? toolsets : []).flatMap((item) => {
      const toolset = row(item);
      return toolset && typeof toolset.name === "string"
        ? [pick(toolset, TOOLSET_FIELDS)]
        : [];
    });
  }
  if (kind === "packages") {
    const packages = row(value)?.packages;
    return {
      packages: (Array.isArray(packages) ? packages : []).flatMap((item) => {
        const card = row(item);
        if (!card || typeof card.id !== "string") return [];
        const skills = Array.isArray(card.skills) ? card.skills : [];
        return [
          {
            ...pick(card, PACKAGE_FIELDS),
            skills: skills.flatMap((entry) => {
              const skill = row(entry);
              return skill && typeof skill.id === "string"
                ? [pick(skill, ["id", "description"])]
                : [];
            }),
          },
        ];
      }),
    };
  }
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
  const upstreamUrl = new URL(PATHS[kind], backendOrigin);
  // Only public catalog filters. Never copy account, agent key, session, or auth query fields.
  if (kind === "toolsets") upstreamUrl.searchParams.set("limit", "20");
  if (kind === "skills") upstreamUrl.searchParams.set("limit", "100");
  const upstreamHeaders = new Headers({ accept: "application/json" });
  // The backend's thread extractors require a transport id even for reads.
  // A fresh, edge-owned id selects anonymous public state and cannot reuse a
  // caller's account-bound thread. These routes require no bearer assertion.
  if (kind === "toolsets" || kind === "models")
    upstreamHeaders.set("x-thread-id", `public-catalog-${crypto.randomUUID()}`);
  let upstream: Response;
  try {
    upstream = await fetchImpl(
      // workerd supports only "follow" and "manual"; a redirecting backend is unavailable.
      new Request(upstreamUrl, {
        method: "GET",
        headers: upstreamHeaders,
        redirect: "manual",
      }),
      { cache: "no-store" },
    );
  } catch {
    return Response.json(
      { error: "catalog_unavailable" },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
  if (upstream.status >= 300 && upstream.status < 400)
    return Response.json(
      { error: "catalog_unavailable" },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  if (!upstream.ok)
    return Response.json(
      { error: "catalog_unavailable" },
      { status: upstream.status, headers: { "cache-control": "no-store" } },
    );
  const body = JSON.stringify(
    projectPublicCatalog(kind, await upstream.json()),
  );
  const etag = `"${await sha256Hex(body)}"`;
  const headers = {
    "content-type": "application/json",
    "cache-control": "public, max-age=0, must-revalidate",
    "cdn-cache-control": "public, max-age=1800, stale-while-revalidate=86400",
    etag,
  };
  if (request.headers.get("if-none-match") === etag)
    return new Response(null, { status: 304, headers });
  return new Response(request.method === "HEAD" ? null : body, {
    status: 200,
    headers,
  });
}

/** `/api/public/catalog/<kind>` on any surface: 404 for an unknown kind or a write. */
export async function servePublicCatalog(
  request: Request,
  kind: string,
  env: EdgeEnv,
  fetchImpl: FetchLike,
): Promise<Response> {
  if (
    !isPublicCatalogKind(kind) ||
    (request.method !== "GET" && request.method !== "HEAD")
  )
    return Response.json({ error: "not_found" }, { status: 404 });
  const [origin] = rankedPool(request, env);
  return origin
    ? publicCatalog(request, kind, origin, fetchImpl)
    : Response.json({ error: "catalog_unavailable" }, { status: 502 });
}

/** The kind a `/api/public/catalog/<kind>` path names. */
export const PUBLIC_CATALOG = /^\/api\/public\/catalog\/([^/]+)$/;
