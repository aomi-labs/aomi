/**
 * The release API: package releases and agent configs, published and promoted
 * by a builder. A package release is uploaded as one `application/x-tar` body;
 * everything else is JSON. The manager parses and checks every upload; these
 * rows only shape the request and type the answer.
 */
import { BackendError, DeployError } from "@aomi-labs/deploy";

import type { ManagerRequest, Raw } from "./endpoints";

/** The largest release body the manager accepts. */
export const RELEASE_MAX_BYTES = 10 * 1024 * 1024;

export type ReleaseKind = "package" | "agent";

export type PackageRelease = {
  number: number;
  digest: string;
  size: number;
  contract: number;
  envelope_hash: string;
  tools: string[];
  status: string;
  created_at: string;
};

export type AgentConfigRelease = { number: number; digest: string; created_at: string };

/** A publish answer: the id (`publisher/name`), the release it stored and the live number. */
export type Published = {
  id: string;
  release: PackageRelease | AgentConfigRelease;
  live: number | null;
  verified?: boolean;
};

/** Every release of one package or agent, newest first. */
export type Releases = { id: string; live: number | null; releases: (PackageRelease | AgentConfigRelease)[] };

export type Promoted = { id: string; live: number };

/** Why the manager refused a release call: `bundle_invalid`, `live_changed`, `too_large`, … */
export type Rejection = { status: number; code: string; message: string; live?: number | null };

/** The manager's (or the edge's) refusal body, or null for any other failure. */
export function rejectionOf(error: unknown): Rejection | null {
  if (!(error instanceof BackendError) || !error.body) return null;
  try {
    const body = JSON.parse(error.body) as { code?: unknown; error?: unknown; message?: unknown; live?: unknown };
    const code = typeof body.code === "string" ? body.code : typeof body.error === "string" ? body.error : null;
    if (!code) return null;
    return {
      status: error.status,
      code,
      message: typeof body.message === "string" ? body.message : "",
      ...(typeof body.live === "number" || body.live === null ? { live: body.live } : {}),
    };
  } catch {
    return null;
  }
}

const PATHS = { package: ["packages", "releases"], agent: ["agents", "configs"] } as const;

function path(kind: ReleaseKind, name: string, leaf: "list" | "promote"): string {
  const [root, list] = PATHS[kind];
  const clean = name.trim();
  if (!clean) throw new DeployError("INVALID_REQUEST", "name is required");
  return `/api/${root}/${encodeURIComponent(clean)}/${leaf === "list" ? list : "promote"}`;
}

/** The answer's `package` or `agent` field is its id. */
const idOf = (kind: ReleaseKind, raw: Raw): string => String(raw[kind] ?? "");

export type PublishPackageInput = {
  name: string;
  /** The tar of the package folder's members. */
  bundle: Uint8Array;
  sourceRepo?: string;
  sourceCommit?: string;
};

export type PublishAgentInput = {
  name: string;
  /** The root `aomi.toml` text. */
  root: string;
  /** The voice files the agent references, by their path in the root folder. */
  files: Record<string, string>;
};

export type PromoteReleaseInput = {
  kind: ReleaseKind;
  name: string;
  number: number;
  /** The live number the caller last read; null before the first promote. */
  expectedLive: number | null;
};

export const RELEASE_ENDPOINTS = {
  publishPackage: (input: PublishPackageInput): ManagerRequest<Published> => ({
    op: "publish_package",
    method: "POST",
    path: path("package", input.name, "list"),
    body: input.bundle,
    headers: {
      ...(input.sourceRepo ? { "x-aomi-source-repo": input.sourceRepo } : {}),
      ...(input.sourceCommit ? { "x-aomi-source-commit": input.sourceCommit } : {}),
    },
    read: (raw) => ({ ...(raw as Omit<Published, "id">), id: idOf("package", raw) }),
  }),

  publishAgent: (input: PublishAgentInput): ManagerRequest<Published> => ({
    op: "publish_agent",
    method: "POST",
    path: path("agent", input.name, "list"),
    body: { root: input.root, files: input.files },
    read: (raw) => ({ id: idOf("agent", raw), release: raw.config, live: raw.live ?? null }),
  }),

  listReleases: (input: { kind: ReleaseKind; name: string }): ManagerRequest<Releases> => ({
    op: "list_releases",
    path: path(input.kind, input.name, "list"),
    read: (raw) => ({
      id: idOf(input.kind, raw),
      live: raw.live ?? null,
      releases: raw.releases ?? raw.configs ?? [],
    }),
  }),

  promoteRelease: (input: PromoteReleaseInput): ManagerRequest<Promoted> => ({
    op: "promote_release",
    method: "POST",
    path: path(input.kind, input.name, "promote"),
    body: { [input.kind === "package" ? "release" : "config"]: input.number, expected_live: input.expectedLive },
    read: (raw) => ({ id: idOf(input.kind, raw), live: Number(raw.live) }),
  }),
};
