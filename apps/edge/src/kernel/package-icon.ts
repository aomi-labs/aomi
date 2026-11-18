import type { EdgeEnv } from "../env";
import { errorResponse } from "./errors";
import { rankedPool } from "./pool";
import { proxy, target, type FetchLike } from "./proxy";

/** A package's icon, the path the Library's `icon_url` names: `/api/packages/<publisher%2Fname>/icon`. */
export const PACKAGE_ICON = /^\/api\/packages\/[^/]+\/icon$/;

const HEADERS = {
  request: new Set(["accept"]),
  response: new Set([
    "content-type",
    "content-length",
    "cache-control",
    "x-content-type-options",
    "content-security-policy",
  ]),
};

/** The icon from the backend. It is public, so no cookie or bearer crosses. */
export async function packageIcon(
  request: Request,
  env: EdgeEnv,
  fetchImpl: FetchLike,
  surface: string,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
  const { pathname } = new URL(request.url);
  try {
    return await proxy(
      request,
      rankedPool(request, env).map((origin) => target(origin, pathname)),
      { fetchImpl, headers: HEADERS },
    );
  } catch (error) {
    return errorResponse(error, {
      surface,
      operation: "package.icon",
      request,
    });
  }
}
