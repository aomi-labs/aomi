import type { NextRequest } from "next/server";

import { backendUrlFromEnv } from "./backend-url";
import {
  BACKEND_API_HEADERS,
  forward,
  UpstreamUnreachableError,
} from "./forward";
import { mintAccountBearer } from "./bearer";

export type AllowedRoute = {
  pattern: RegExp;
  methods: ReadonlySet<string>;
  /**
   * `required` (default) forwards only with an account bearer. `optional`
   * forwards anonymously when no account resolves. `none` never resolves an
   * account, so the route touches no account state.
   */
  auth?: "required" | "optional" | "none";
};

export type ResolveCanonicalUserId = (
  request: NextRequest,
) => Promise<string | null>;

export type ProxyFailure =
  | {
      kind: "bearer_mint";
      error: unknown;
      method: string;
      pathname: string;
      responseStatus: number;
    }
  | {
      kind: "upstream_request";
      error: unknown;
      method: string;
      pathname: string;
      responseStatus: number;
    }
  | {
      kind: "response_transform";
      error: unknown;
      method: string;
      pathname: string;
      responseStatus: number;
    }
  | {
      kind: "upstream_response";
      status: number;
      method: string;
      pathname: string;
      responseStatus: number;
    };

export type ObserveProxyFailure = (
  failure: ProxyFailure,
) => void | Promise<void>;

function notifyProxyFailure(
  observer: ObserveProxyFailure | undefined,
  failure: ProxyFailure,
): void {
  try {
    const result = observer?.(failure);
    if (result) void result.catch(() => {});
  } catch {
    // Observability is best-effort and must not alter proxy behavior.
  }
}

export type ProxyConfig = {
  /** Backend routes this proxy forwards; anything else is a 404. */
  allowedRoutes: ReadonlyArray<AllowedRoute>;
  /** Adjust the upstream URL before forwarding (e.g. a default query param). */
  applyDefaults?: (upstreamUrl: URL) => void;
  upstreamBaseUrl?: string;
  /** The account to mint a bearer for, or null for an anonymous request. */
  resolveCanonicalUserId: ResolveCanonicalUserId;
  /** Observe failures without exposing request or response data. */
  observeFailure?: ObserveProxyFailure;
};

/**
 * An allow-listed proxy from an app's /api routes to the Rust backend. The
 * account bearer is minted server-side; the browser's own credentials never
 * cross.
 */
export function createBackendProxy(config: ProxyConfig) {
  async function handle(
    req: NextRequest,
    context: { params: Promise<{ slug?: string[] }> },
  ): Promise<Response> {
    const { slug } = await context.params;
    const url = new URL(
      `/api/${(slug ?? []).join("/")}`,
      config.upstreamBaseUrl ?? backendUrlFromEnv(process.env),
    );
    url.search = req.nextUrl.search;
    config.applyDefaults?.(url);
    const route = config.allowedRoutes.find(
      (candidate) =>
        candidate.pattern.test(url.pathname) &&
        candidate.methods.has(req.method),
    );
    if (!route) {
      return Response.json({ error: "Unsupported API route" }, { status: 404 });
    }
    const failure = { method: req.method, pathname: url.pathname };

    const accountId =
      route.auth === "none" ? null : await config.resolveCanonicalUserId(req);
    if (!accountId && (route.auth ?? "required") === "required") {
      return Response.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }
    let bearer: string | undefined;
    if (accountId) {
      try {
        bearer = (await mintAccountBearer(accountId)).bearer;
      } catch (error) {
        notifyProxyFailure(config.observeFailure, {
          kind: "bearer_mint",
          error,
          ...failure,
          responseStatus: 502,
        });
        return Response.json({ error: "bearer_mint_failed" }, { status: 502 });
      }
    }

    try {
      const upstream = await forward({
        request: req,
        url,
        policy: BACKEND_API_HEADERS,
        bearer,
      });
      if (upstream.status >= 500) {
        notifyProxyFailure(config.observeFailure, {
          kind: "upstream_response",
          status: upstream.status,
          ...failure,
          responseStatus: upstream.status,
        });
      }
      return upstream;
    } catch (error) {
      notifyProxyFailure(config.observeFailure, {
        kind: "upstream_request",
        error: error instanceof UpstreamUnreachableError ? error.cause : error,
        ...failure,
        responseStatus: 502,
      });
      return Response.json(
        { error: "Upstream request failed" },
        { status: 502 },
      );
    }
  }

  return {
    GET: handle,
    POST: handle,
    PUT: handle,
    PATCH: handle,
    DELETE: handle,
  };
}
