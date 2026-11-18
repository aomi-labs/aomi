/**
 * The release API: package releases and agent configs, published and promoted
 * by a builder, and the builder's read models over them (its publisher's
 * agents and packages, one agent, one package) with a package's builder
 * secrets. A package release is uploaded as one `application/x-tar` body;
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

export type AgentStatus = "active" | "inactive" | "needs_rebuild" | "retired";

/** The builder's publisher and everything it owns: agents and packages, listed apart. */
export type Publisher = {
  publisher: string;
  agents: { id: string; display_name: string; status: AgentStatus; live_config: number | null }[];
  packages: {
    id: string;
    display_name: string;
    /** The live release's icon route, or null when it sets no `[package] icon`. */
    icon_url: string | null;
    live_release: number | null;
    verified: boolean;
    listed: boolean;
    active: boolean;
  }[];
};

/** Where a live release or config came from; a publish without provenance records neither. */
export type Source = { source_repo: string | null; commit: string | null; created_at: string };

/** The stored agent config: the repo's `[[agents]]` table, resolved (registry `AgentConfig`). */
export type AgentConfig = {
  name: string;
  display_name: string;
  /** The voice markdown text, or null to speak as Aomi. */
  voice: string | null;
  chains: string[];
  /** `publisher/name` package ids. */
  packages: string[];
  model_cost: "builder" | "person";
  audience: "public" | "signed-in";
  /** Origins that may embed the agent; empty means any. */
  allowed_origins: string[];
  wallet_rules: {
    default: "ask" | "instant";
    families: ("evm" | "svm")[];
    agent: boolean;
    others?: boolean;
    create?: boolean;
    ask_only: boolean;
  };
  telegram: { show_tool_calls: boolean; group: { enabled: boolean; tools: string[] } };
  /** A Telegram command that calls one tool by its full `<package>_<tool>` name. */
  shortcuts: { command: string; tool: string }[];
};

export type Channel = { id: string; kind: string; external_bot_id: string; live: boolean };

export type Agent = {
  agent: { id: string; display_name: string; status: AgentStatus };
  live: (Source & { number: number; digest: string; config: AgentConfig }) | null;
  channels: Channel[];
};

export type SlotStatus = "set" | "missing" | "users_add_their_own";

/** A secret a package declares: the builder sets its value, or each person adds their own. */
export type SecretSlot = {
  name: string;
  owner: "builder" | "person";
  description: string;
  required: boolean;
  status: SlotStatus;
};

export type Package = {
  package: {
    id: string;
    display_name: string;
    description: string;
    icon_url: string | null;
    listed: boolean;
    active: boolean;
  };
  live:
    | (Source & {
        release: number;
        digest: string;
        tools: { name: string; description: string; audience: string }[];
        skills: { id: string; description: string }[];
        envelope: { hash: string; hosts: string[]; transactions: unknown; signatures: unknown };
        guards: boolean;
        limits: Record<string, unknown>;
      })
    | null;
  verified: boolean;
  slots: SecretSlot[];
};

const PATHS = { package: ["packages", "releases"], agent: ["agents", "configs"] } as const;

function named(value: string, field = "name"): string {
  const clean = value.trim();
  if (!clean) throw new DeployError("INVALID_REQUEST", `${field} is required`);
  return encodeURIComponent(clean);
}

function path(kind: ReleaseKind, name: string, leaf: "list" | "promote"): string {
  const [root, list] = PATHS[kind];
  return `/api/${root}/${named(name)}/${leaf === "list" ? list : "promote"}`;
}

const secretPath = (input: { name: string; slot: string }): string =>
  `/api/packages/${named(input.name)}/secrets/${named(input.slot, "slot")}`;

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
  getPublisher: (): ManagerRequest<Publisher> => ({
    op: "get_publisher",
    path: "/api/publishers/me",
    read: (raw) => ({ publisher: String(raw.publisher ?? ""), agents: raw.agents ?? [], packages: raw.packages ?? [] }),
  }),

  getAgent: (input: { name: string }): ManagerRequest<Agent> => ({
    op: "get_agent",
    path: `/api/agents/${named(input.name)}`,
    read: (raw) => ({ agent: raw.agent, live: raw.live ?? null, channels: raw.channels ?? [] }),
  }),

  getPackage: (input: { name: string }): ManagerRequest<Package> => ({
    op: "get_package",
    path: `/api/packages/${named(input.name)}`,
    read: (raw) => ({ package: raw.package, live: raw.live ?? null, verified: raw.verified === true, slots: raw.slots ?? [] }),
  }),

  /** Set a builder slot's value. The value is never read back. */
  setPackageSecret: (input: { name: string; slot: string; value: string }): ManagerRequest<{ slot: string; status: SlotStatus }> => ({
    op: "set_package_secret",
    method: "PUT",
    path: secretPath(input),
    body: { value: input.value },
    read: (raw) => ({ slot: String(raw.slot ?? input.slot), status: raw.status }),
  }),

  clearPackageSecret: (input: { name: string; slot: string }): ManagerRequest<{ status: SlotStatus }> => ({
    op: "clear_package_secret",
    method: "DELETE",
    path: secretPath(input),
    read: (raw) => ({ status: raw.status }),
  }),

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
