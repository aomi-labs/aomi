import { createHash } from "node:crypto";

import { getPool } from "../db/pool";

export const BETTER_AUTH_OAUTH_PROVIDER_VERSION = "1.7.1";

export type OAuthRedirectFailureDiagnostics = {
  clientIdHash: string;
  clientFound: boolean;
  registeredRedirectCount: number;
  registeredStorageShape:
    | "json_array"
    | "json_encoded_array"
    | "missing"
    | "invalid";
  requestedUrlValid: boolean;
  credentialsAbsent: boolean;
  fragmentAbsent: boolean;
  exactMatch: boolean;
  loopbackMatch: boolean;
  protocolMatch: boolean;
  hostnameMatch: boolean;
  portMatch: boolean;
  pathMatch: boolean;
  queryMatch: boolean;
};

type ParsedRedirect = {
  url: URL;
  hasUserinfoDelimiter: boolean;
  hasQueryDelimiter: boolean;
  hasFragmentDelimiter: boolean;
};

type ComponentComparison = Pick<
  OAuthRedirectFailureDiagnostics,
  "protocolMatch" | "hostnameMatch" | "portMatch" | "pathMatch" | "queryMatch"
>;

/**
 * Explain a rejected redirect without returning any URL or client identifier.
 * This is observability only: Better Auth remains the authorization decision.
 */
export async function oauthRedirectFailureDiagnostics(
  clientId: string,
  requestedRedirectUri: string,
): Promise<OAuthRedirectFailureDiagnostics> {
  const result = await getPool().query(
    `select redirect_uris
       from ba_oauth_clients
      where client_id = $1
      limit 1`,
    [clientId],
  );
  const stored = result.rows[0]?.redirect_uris;
  const { redirects, shape } = redirectValues(stored);
  const requested = parsedRedirect(requestedRedirectUri);
  const registered = redirects.map(parsedRedirect).filter(isParsedRedirect);
  const credentialsAbsent = requested
    ? !requested.url.username &&
      !requested.url.password &&
      !requested.hasUserinfoDelimiter
    : false;
  const fragmentAbsent = requested
    ? !requested.url.hash && !requested.hasFragmentDelimiter
    : false;
  const components = closestComponentComparison(registered, requested);

  return {
    clientIdHash: hashOAuthClientId(clientId),
    clientFound: result.rows.length > 0,
    registeredRedirectCount: redirects.length,
    registeredStorageShape: shape,
    requestedUrlValid: Boolean(requested),
    credentialsAbsent,
    fragmentAbsent,
    exactMatch: redirects.includes(requestedRedirectUri),
    loopbackMatch: Boolean(
      requested &&
      credentialsAbsent &&
      fragmentAbsent &&
      registered.some(
        (registeredRedirect) =>
          isLoopbackIp(registeredRedirect.url.hostname) &&
          registeredRedirect.url.hostname === requested.url.hostname &&
          registeredRedirect.url.protocol === requested.url.protocol &&
          registeredRedirect.url.pathname === requested.url.pathname &&
          sameQuery(registeredRedirect, requested) &&
          !registeredRedirect.url.username &&
          !registeredRedirect.url.password &&
          !registeredRedirect.url.hash &&
          !registeredRedirect.hasUserinfoDelimiter &&
          !registeredRedirect.hasFragmentDelimiter,
      ),
    ),
    ...components,
  };
}

export function hashOAuthClientId(clientId: string): string {
  return createHash("sha256").update(clientId).digest("hex").slice(0, 16);
}

function redirectValues(value: unknown): {
  redirects: string[];
  shape: OAuthRedirectFailureDiagnostics["registeredStorageShape"];
} {
  if (value === undefined || value === null) {
    return { redirects: [], shape: "missing" };
  }
  if (Array.isArray(value)) {
    return {
      redirects: value.filter(
        (item): item is string => typeof item === "string",
      ),
      shape: "json_array",
    };
  }
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return {
          redirects: parsed.filter(
            (item): item is string => typeof item === "string",
          ),
          shape: "json_encoded_array",
        };
      }
    } catch {
      // Report the shape, never the value.
    }
  }
  return { redirects: [], shape: "invalid" };
}

function parsedRedirect(value: string): ParsedRedirect | null {
  try {
    const url = new URL(value);
    const authority = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(value)?.[1];
    return {
      url,
      hasUserinfoDelimiter: authority?.includes("@") ?? false,
      hasQueryDelimiter: value.includes("?"),
      hasFragmentDelimiter: value.includes("#"),
    };
  } catch {
    return null;
  }
}

function isParsedRedirect(
  value: ParsedRedirect | null,
): value is ParsedRedirect {
  return value !== null;
}

function closestComponentComparison(
  registered: ParsedRedirect[],
  requested: ParsedRedirect | null,
): ComponentComparison {
  const none: ComponentComparison = {
    protocolMatch: false,
    hostnameMatch: false,
    portMatch: false,
    pathMatch: false,
    queryMatch: false,
  };
  if (!requested) return none;

  let closest = none;
  let closestScore = -1;
  for (const candidate of registered) {
    const comparison: ComponentComparison = {
      protocolMatch: candidate.url.protocol === requested.url.protocol,
      hostnameMatch: candidate.url.hostname === requested.url.hostname,
      portMatch: candidate.url.port === requested.url.port,
      pathMatch: candidate.url.pathname === requested.url.pathname,
      queryMatch: sameQuery(candidate, requested),
    };
    const score = Object.values(comparison).filter(Boolean).length;
    if (score > closestScore) {
      closest = comparison;
      closestScore = score;
    }
  }
  return closest;
}

function sameQuery(left: ParsedRedirect, right: ParsedRedirect): boolean {
  return (
    left.url.search === right.url.search &&
    left.hasQueryDelimiter === right.hasQueryDelimiter
  );
}

function isLoopbackIp(hostname: string): boolean {
  const host = hostname.startsWith("[")
    ? hostname.slice(1, -1).toLowerCase()
    : hostname.toLowerCase();
  if (host === "::1") return true;
  const octets = host.split(".");
  return (
    octets.length === 4 &&
    octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255) &&
    octets[0] === "127"
  );
}
