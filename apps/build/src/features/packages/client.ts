// The builder's agents and packages, read through the Edge (`/api/build/...`,
// the manager's builder reads and release routes). Repo config is read-only
// here: Build changes only which release is live and a package's builder
// secret values.
import type {
  ActivationCode,
  Agent,
  AgentConfigRelease,
  IssuedCode,
  Package,
  PackageRelease,
  Publisher,
  ReleaseKind,
  SlotStatus,
  Source,
} from "@aomi-labs/internal/manager";

import { API_PATHS } from "@/lib/api-paths";
import { HttpRequestError, readJsonResponse } from "@/lib/request-retry";
import { buildFetch } from "@/lib/session-expiry";

export type {
  ActivationCode,
  Agent,
  AgentConfigRelease,
  Package,
  PackageRelease,
  Publisher,
  ReleaseKind,
  Source,
};

export type Release = PackageRelease | AgentConfigRelease;
export type ReleaseList = { live: number | null; releases: Release[] };

const paths = API_PATHS.build;

async function json<T>(
  url: string,
  label: string,
  init?: RequestInit,
): Promise<T> {
  return readJsonResponse<T>(await buildFetch(url, init), `${label} failed`);
}

function send(method: "POST" | "PUT" | "DELETE", body?: unknown): RequestInit {
  return {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

/** The name an id (`publisher/name`) is addressed by in its publisher's routes. */
export function shortName(id: string): string {
  return id.slice(id.indexOf("/") + 1);
}

/** `#14 · a3f9c1`: a release number and the first six hex digits of its digest. */
export function releaseLabel(release: {
  number: number;
  digest: string;
}): string {
  return `#${release.number} · ${release.digest.replace(/^sha256:/, "").slice(0, 6)}`;
}

export const fetchPublisher = () =>
  json<Publisher>(paths.publisher, "Publisher");

export const fetchAgent = (name: string) =>
  json<Agent>(paths.agent(name), "Agent");

export const fetchPackage = (name: string) =>
  json<Package>(paths.package(name), "Package");

export async function fetchReleases(
  kind: ReleaseKind,
  name: string,
): Promise<ReleaseList> {
  const url =
    kind === "package" ? paths.packageReleases(name) : paths.agentConfigs(name);
  const raw = await json<{
    live?: number | null;
    releases?: Release[];
    configs?: Release[];
  }>(url, "Releases");
  return {
    live: raw.live ?? null,
    releases: raw.releases ?? raw.configs ?? [],
  };
}

/** The manager refused a promote because the live pointer moved; `live` is where it is now. */
export class LiveChanged extends Error {
  constructor(readonly live: number | null) {
    super(
      `The live release ${live == null ? "changed" : `moved to #${live}`} since this page loaded. Nothing was promoted; check the list and try again.`,
    );
    this.name = "LiveChanged";
  }
}

export async function promote(input: {
  kind: ReleaseKind;
  name: string;
  number: number;
  expectedLive: number | null;
}): Promise<{ live: number }> {
  const url =
    input.kind === "package"
      ? paths.packagePromote(input.name)
      : paths.agentPromote(input.name);
  const body = {
    [input.kind === "package" ? "release" : "config"]: input.number,
    expected_live: input.expectedLive,
  };
  try {
    return await json<{ live: number }>(url, "Promote", send("POST", body));
  } catch (error) {
    const refusal =
      error instanceof HttpRequestError
        ? (error.body as {
            code?: string;
            message?: string;
            live?: number | null;
          })
        : null;
    if (
      error instanceof HttpRequestError &&
      error.status === 409 &&
      refusal?.code === "live_changed"
    )
      throw new LiveChanged(refusal.live ?? null);
    if (refusal?.message)
      throw new HttpRequestError(refusal.message, {
        status: (error as HttpRequestError).status,
      });
    throw error;
  }
}

export const setSecret = (name: string, slot: string, value: string) =>
  json<{ slot: string; status: SlotStatus }>(
    paths.packageSecret(name, slot),
    "Secret",
    send("PUT", { value }),
  );

/** A builder key as the Edge lists it. Times are unix seconds. */
export type BuilderKey = {
  id: number;
  prefix: string;
  label: string | null;
  capabilities: string[];
  /** The publisher a `publisher:observe` key reads. */
  publisher: string | null;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
};

export const fetchKeys = () => json<{ keys: BuilderKey[] }>(paths.keys, "Keys");

/** The created key, whose `key` is shown once and never again. */
export const createKey = (input: {
  label: string;
  capabilities: string[];
  publisher?: string;
}) =>
  json<BuilderKey & { key: string }>(
    paths.keys,
    "Create key",
    send("POST", input),
  );

export const revokeKey = (id: number) =>
  json<{ ok: true }>(paths.keys, "Revoke key", send("DELETE", { id }));

/** A manager call whose refusal reads as the manager's `message`. */
async function managed<T>(
  url: string,
  label: string,
  init?: RequestInit,
): Promise<T> {
  try {
    return await json<T>(url, label, init);
  } catch (error) {
    if (!(error instanceof HttpRequestError)) throw error;
    const message = (error.body as { message?: string } | undefined)?.message;
    if (!message) throw error;
    throw new HttpRequestError(message, { status: error.status });
  }
}

export const fetchCodes = (name: string) =>
  managed<{ codes: ActivationCode[] }>(paths.packageCodes(name), "Codes");

/** A new code for people, or for one agent; its `code` is shown once and never again. */
export const issueCode = (name: string, agent?: string) =>
  managed<IssuedCode>(
    paths.packageCodes(name),
    "New access key",
    send("POST", agent ? { agent } : {}),
  );

export const revokeCode = (name: string, id: number) =>
  managed<{ revoked: number }>(
    paths.packageCode(name, id),
    "Revoke code",
    send("DELETE"),
  );

export const removeGrant = (name: string, id: number) =>
  managed<{ revoked: boolean }>(
    paths.packageGrant(name, id),
    "Remove access",
    send("DELETE"),
  );
