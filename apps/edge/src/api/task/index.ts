/**
 * The Task venue adapter: everything x402 venues need that the Task contract
 * itself does not. The API Server and Payment publish the contract and the
 * terms; discovery documents, probe answers and listing metadata are made
 * here.
 */
import type { EdgeEnv } from "../../env";
import { TwoTierCache } from "../../kernel/cache";
import { EdgeError } from "../../kernel/errors";
import type { FetchLike } from "../../kernel/proxy";
import type { TaskDocument } from "../routes";
import { normaliseTaskBody } from "./body";
import { discoveryChallenge, discoveryResponse } from "./challenge";
import { agentManifest, buildMetadata, taskOpenapi, wellKnownX402 } from "./documents";
import { jsonResponse, type Ordered, parseOrdered } from "./json";
import { taskTerms } from "./terms";

// The canonical contract changes only with an API Server deploy.
const CANONICAL_TTL_SECONDS = 300;
const canonicalCache = new TwoTierCache();

export function resetCanonicalCache(): void {
  canonicalCache.clear();
}

async function canonicalContract(apiServer: URL, env: EdgeEnv, fetchImpl: FetchLike): Promise<Ordered> {
  const key = `task:canonical-openapi:v1:${apiServer.host}`;
  let text = await canonicalCache.get(key, env.EDGE_CACHE);
  if (!text) {
    const response = await fetchImpl(new Request(new URL("/openapi.json", apiServer), { headers: { accept: "application/json" } }), {
      cache: "no-store",
    }).catch(() => null);
    if (!response?.ok) throw new EdgeError(503, "api_server_unavailable");
    text = await response.text();
    await canonicalCache.put(key, text, CANONICAL_TTL_SECONDS, env.EDGE_CACHE);
  }
  try {
    return parseOrdered(text) as Ordered;
  } catch (cause) {
    throw new EdgeError(502, "invalid_api_contract", { cause });
  }
}

/** One discovery document; HEAD gets the headers alone, as the API Server's GET routes did. */
export async function taskDocument(
  document: TaskDocument,
  request: Request,
  apiServer: URL,
  env: EdgeEnv,
  fetchImpl: FetchLike,
): Promise<Response> {
  const terms = await taskTerms(env, fetchImpl);
  const value =
    document === "agent"
      ? agentManifest(terms)
      : document === "x402"
        ? wellKnownX402(terms)
        : taskOpenapi(terms, await canonicalContract(apiServer, env, fetchImpl));
  const response = jsonResponse(value);
  return request.method === "HEAD" ? new Response(null, { headers: response.headers }) : response;
}

/**
 * The API Server's answer to an empty, unlabelled POST, for when no challenge
 * can be had: what venues saw before the edge answered probes.
 */
function bodyRequired(): Response {
  return jsonResponse({ error: { code: "invalid_request", message: "request body is required" } }, 422, {
    "cache-control": "no-store",
  });
}

/**
 * The payable build as venues probe it. GET, HEAD and an empty POST get the
 * cached body-bound 402 for the published example, or the read-only metadata
 * (an unlabelled empty POST: the 422) when no challenge can be had; a JSON
 * body sent with the wrong label is relabelled. Anything else is forwarded as
 * it is, and `listOnBazaar` lists what comes back.
 */
export async function adaptTaskBuild(
  request: Request,
  apiServer: URL,
  env: EdgeEnv,
  fetchImpl: FetchLike,
): Promise<{ respond: Response } | { forward: Request }> {
  const probe = request.method === "GET" || request.method === "HEAD";
  if (!probe && request.method !== "POST") return { forward: request };
  const body = probe ? null : await normaliseTaskBody(request);
  if (body && body.kind !== "empty") return { forward: body.request };
  const terms = probe ? await taskTerms(env, fetchImpl) : await taskTerms(env, fetchImpl).catch(() => null);
  if (!terms) return { forward: request };
  const challenge = await discoveryChallenge(apiServer, terms, env, fetchImpl);
  if (challenge) return { respond: discoveryResponse(challenge, request.method) };
  if (!probe) return request.headers.has("content-type") ? { forward: request } : { respond: bodyRequired() };
  const metadata = jsonResponse(buildMetadata(terms));
  return { respond: request.method === "HEAD" ? new Response(null, { headers: metadata.headers }) : metadata };
}
