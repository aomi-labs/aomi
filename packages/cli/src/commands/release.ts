import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, normalize, resolve } from "node:path";
import {
  ManagerClient,
  rejectionOf,
  type Published,
  type ReleaseKind,
} from "@aomi-labs/internal/manager";
import { core } from "../build-core";
import { CliError, json, messageOf, out, usage } from "../context";
import {
  bundle,
  packagesOf,
  selected,
  type BuildFlags,
  type Phase,
  type Project,
} from "./build";

/** How a release command reaches Build, and as whom. */
type BuilderFlags = { keyFile?: string; buildUrl?: string; json?: boolean };

/** `AOMI_BUILDER_KEY` or `--key-file`: a builder API key, never printed. */
function builderKey(flags: BuilderFlags): string {
  const key = (
    flags.keyFile
      ? readFileSync(flags.keyFile, "utf8")
      : process.env.AOMI_BUILDER_KEY
  )?.trim();
  if (!key) throw usage("Set AOMI_BUILDER_KEY or pass --key-file");
  return key;
}

/**
 * The release API on the Build edge, which serves the manager's `/api/<path>`
 * at `/api/build/<path>` and swaps the key for a builder bearer.
 */
function builder(flags: BuilderFlags): ManagerClient {
  const origin = (
    flags.buildUrl ??
    process.env.AOMI_BUILD_URL ??
    "https://build.aomi.dev"
  ).replace(/\/+$/, "");
  return new ManagerClient({
    url: origin,
    bearer: builderKey(flags),
    fetch: (input, init) => {
      const url = new URL(String(input));
      url.pathname = url.pathname.replace(/^\/api\//, "/api/build/");
      return fetch(url, init);
    },
  });
}

/** A refusal prints as `code: message`. */
async function refused<T>(call: Promise<T>): Promise<T> {
  return call.catch((error: unknown) => {
    const rejection = rejectionOf(error);
    if (!rejection) throw error;
    throw new CliError(
      [rejection.code, rejection.message].filter(Boolean).join(": "),
    );
  });
}

function kindOf(value: string): ReleaseKind {
  if (value !== "package" && value !== "agent")
    throw usage(`Expected package or agent, not ${value}`);
  return value;
}

function numberOf(value: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0)
    throw usage(`${value} is not a release number`);
  return number;
}

/** A path the manifest names, kept inside its folder. */
function inside(dir: string, path: string): string {
  const clean = normalize(path);
  if (isAbsolute(clean) || clean.startsWith(".."))
    throw usage(`${path} is outside ${dir}`);
  return clean;
}

function print(kind: string, result: Published): void {
  out(
    `${kind} ${result.id}  release ${result.release.number}  ${result.release.digest}  live ${result.live ?? "-"}`,
  );
}

type PublishFlags = BuilderFlags &
  BuildFlags & {
    root?: string;
    package?: string[];
    agent?: string[];
    promote?: boolean;
  };

type Failure = {
  kind: ReleaseKind;
  name: string;
  phase: Phase;
  message: string;
};
const line = ({ name, message }: Failure) => `${name}: ${message}`;

/**
 * `aomi build publish`: build each package of the root `aomi.toml`, pack and check
 * it with `aomi-build-core`, upload it, then publish the root's agents;
 * `--promote` makes each new release live. Without `--package` or `--agent`
 * it publishes everything the root lists. Each upload prints as it lands,
 * even when its promotion is refused; one that fails is reported after the
 * rest publish, with `--json` as `{failed: [{kind, name, phase, message}]}`.
 * Each promote moves one pointer, so a failure names the pointers that
 * already moved.
 */
export async function publish(flags: PublishFlags): Promise<void> {
  const root = resolve(flags.root ?? ".");
  const rootText = readFileSync(join(root, "aomi.toml"), "utf8");
  const project = core<Project>(["manifest", root]);
  const everything = !flags.package?.length && !flags.agent?.length;
  const listed =
    everything || flags.package?.length ? packagesOf(root, project) : [];
  const packages = selected(root, listed, flags.package);
  const { agents } = project;
  const unnamed: Failure[] = listed.flatMap(({ path, failure }) =>
    failure
      ? [{ kind: "package", name: path, phase: "manifest", message: failure }]
      : [],
  );
  for (const name of flags.agent ?? [])
    if (!agents.some((agent) => agent.name === name))
      throw usage(`${name} is not an agent of ${root}/aomi.toml`);

  const client = builder(flags);
  const failed = everything ? unnamed : [];
  const moved: string[] = [];
  /** Run `upload` and promote its release; the upload reports either way. */
  const release = async (
    kind: ReleaseKind,
    name: string,
    upload: (at: (phase: Phase) => void) => Promise<Published>,
  ) => {
    let phase: Phase = "upload";
    try {
      const result = await upload((next) => (phase = next));
      phase = "promote";
      try {
        if (flags.promote && result.live !== result.release.number) {
          const { live } = await refused(
            client.promoteRelease({
              kind,
              name,
              number: result.release.number,
              expectedLive: result.live,
            }),
          );
          moved.push(
            `${kind} ${result.id}  live ${live} (was ${result.live ?? "-"})${result.live === null ? "" : `  undo: aomi build rollback ${kind} ${name} ${result.live}`}`,
          );
          result.live = live;
        }
      } finally {
        if (flags.json) json(result);
        else print(kind, result);
      }
    } catch (error) {
      failed.push({ kind, name, phase, message: messageOf(error) });
    }
  };
  const bundles = mkdtempSync(join(tmpdir(), "aomi-bundles-"));
  try {
    for (const { name, dir } of packages) {
      await release("package", name!, async (at) => {
        const file = join(bundles, `${name}.tar`);
        bundle({ dir, name: name! }, flags, file, at);
        at("upload");
        return refused(
          client.publishPackage({
            name: name!,
            bundle: readFileSync(file),
            sourceRepo: process.env.GITHUB_REPOSITORY,
            sourceCommit: process.env.GITHUB_SHA,
          }),
        );
      });
    }

    for (const agent of agents) {
      if (!everything && !flags.agent?.includes(agent.name)) continue;
      await release("agent", agent.name, async () => {
        const files = agent.voice
          ? {
              [agent.voice]: readFileSync(
                join(root, inside(root, agent.voice)),
                "utf8",
              ),
            }
          : {};
        return refused(
          client.publishAgent({ name: agent.name, root: rootText, files }),
        );
      });
    }
    if (failed.length) {
      if (flags.json) json({ failed });
      throw new CliError(failed.map(line).join("\n"));
    }
  } catch (error) {
    if (!moved.length) throw error;
    throw new CliError(
      [
        messageOf(error),
        "These pointers moved before the failure:",
        ...moved.map((line) => `  ${line}`),
      ].join("\n"),
    );
  } finally {
    rmSync(bundles, { recursive: true, force: true });
  }
}

/**
 * `aomi build promote <package|agent> <name> <number>`: make a release
 * live, and `aomi build rollback`, which takes the same explicit number: the release before
 * the live one may never have been live.
 */
export async function promote(
  flags: BuilderFlags,
  kind: string,
  name: string,
  number: string,
): Promise<void> {
  const client = builder(flags);
  const releaseKind = kindOf(kind);
  const { live } = await refused(
    client.listReleases({ kind: releaseKind, name }),
  );
  const result = await refused(
    client.promoteRelease({
      kind: releaseKind,
      name,
      number: numberOf(number),
      expectedLive: live,
    }),
  );
  if (flags.json) return json(result);
  out(`${kind} ${result.id}  live ${result.live} (was ${live ?? "-"})`);
}

/** `aomi build releases <package|agent> <name>`: newest first. */
export async function releases(
  flags: BuilderFlags,
  kind: string,
  name: string,
): Promise<void> {
  const list = await refused(
    builder(flags).listReleases({ kind: kindOf(kind), name }),
  );
  if (flags.json) return json(list);
  for (const release of list.releases)
    out(
      `${String(release.number).padStart(4)}  ${release.digest}  ${release.created_at}${release.number === list.live ? "  live" : ""}`,
    );
}

/**
 * `aomi build codes create <package> [--agent <publisher/name>]`: a new activation
 * code for a private package. People add the package with it in the Library;
 * with `--agent`, that agent gets the package at once. The code is printed
 * once and never again.
 */
export async function createCode(
  flags: BuilderFlags & { agent?: string },
  name: string,
): Promise<void> {
  const issued = await refused(
    builder(flags).issueCode({ name, agent: flags.agent }),
  );
  if (flags.json) return json(issued);
  out(issued.code);
  out(
    `code ${issued.id}  ${issued.package}  for ${issued.agent ?? "people with the code"}  (not shown again)`,
  );
}

/** `aomi build codes list <package>`: newest first, with how many hold each. */
export async function listCodes(
  flags: BuilderFlags,
  name: string,
): Promise<void> {
  const list = await refused(builder(flags).listCodes({ name }));
  if (flags.json) return json(list);
  for (const code of list.codes) {
    const holding = code.grants.filter((grant) => !grant.revoked_at).length;
    out(
      `${String(code.id).padStart(4)}  ${code.created_at}  ${code.agent ?? "people"}  ${holding} holding  ${code.revoked_at ? "revoked" : "active"}`,
    );
  }
}

/** `aomi build codes revoke <package> <id>`: nobody can redeem it again, and everyone who did loses the package. */
export async function revokeCode(
  flags: BuilderFlags,
  name: string,
  id: string,
): Promise<void> {
  const code = numberOf(id);
  const result = await refused(builder(flags).revokeCode({ name, code }));
  if (flags.json) return json(result);
  out(`code ${code} revoked`);
}
