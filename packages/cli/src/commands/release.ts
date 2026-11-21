import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, normalize, resolve } from "node:path";
import {
  ManagerClient,
  rejectionOf,
  type Published,
  type ReleaseKind,
} from "@aomi-labs/internal/manager";
import { parse } from "toml";
import { core } from "../build-core";
import { CliError, json, messageOf, out, usage } from "../context";

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

function toml(path: string): Record<string, any> {
  try {
    return parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw usage(`${path}: ${(error as Error).message}`);
  }
}

/** A path the manifest names, kept inside its folder. */
function inside(dir: string, path: string): string {
  const clean = normalize(path);
  if (isAbsolute(clean) || clean.startsWith(".."))
    throw usage(`${path} is outside ${dir}`);
  return clean;
}

/** A plain ustar archive of `members`, in order. */
function tar(members: [string, Uint8Array][]): Uint8Array {
  const blocks: Uint8Array[] = [];
  const encoder = new TextEncoder();
  for (const [name, data] of members) {
    const header = new Uint8Array(512);
    const put = (offset: number, text: string) =>
      header.set(encoder.encode(text), offset);
    if (encoder.encode(name).length > 100)
      throw usage(`${name}: paths are at most 100 bytes`);
    put(0, name);
    put(100, "0000644\0");
    put(108, "0000000\0");
    put(116, "0000000\0");
    put(124, `${data.length.toString(8).padStart(11, "0")}\0`);
    put(136, "00000000000\0");
    put(148, "        ");
    put(156, "0");
    put(257, "ustar\u000000");
    const sum = header.reduce((total, byte) => total + byte, 0);
    put(148, `${sum.toString(8).padStart(6, "0")}\0 `);
    blocks.push(
      header,
      data,
      new Uint8Array((512 - (data.length % 512)) % 512),
    );
  }
  blocks.push(new Uint8Array(1024));
  const archive = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0));
  let offset = 0;
  for (const block of blocks) {
    archive.set(block, offset);
    offset += block.length;
  }
  return archive;
}

/**
 * The TypeScript packer: the members `dir/aomi.toml` declares, in a plain
 * tar. Publish packs with `aomi-build-core`; this stays only until
 * `release.test.ts` shows both give the same release on official packages.
 */
export function tarPackage(dir: string, wasm?: string): Uint8Array {
  const {
    icon,
    guards,
    skills = [],
  } = toml(join(dir, "aomi.toml")).package ?? {};
  const listed = [
    icon,
    ...(skills as { path: string }[]).map((skill) => skill.path),
    guards,
  ].filter((path): path is string => typeof path === "string");
  return tar([
    ["aomi.toml", readFileSync(join(dir, "aomi.toml"))],
    ...(wasm
      ? [["package.wasm", readFileSync(wasm)] as [string, Uint8Array]]
      : []),
    ...listed.map((path): [string, Uint8Array] => {
      const member = inside(dir, path);
      return [member, readFileSync(join(dir, member))];
    }),
  ]);
}

/** `cargo build` the package's folder for wasm32-wasip2; its one `.wasm`. */
function cargoBuild(dir: string): string {
  const output = execFileSync(
    "cargo",
    [
      "build",
      "--release",
      "--target",
      "wasm32-wasip2",
      "--message-format=json-render-diagnostics",
    ],
    { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  const manifest = resolve(dir, "Cargo.toml");
  const wasm = output
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line))
    .filter(
      (message) =>
        message.reason === "compiler-artifact" &&
        message.manifest_path === manifest,
    )
    .flatMap((message) => message.filenames as string[])
    .find((file) => file.endsWith(".wasm"));
  if (!wasm) throw new CliError(`cargo built no .wasm in ${dir}`);
  return wasm;
}

function print(kind: string, result: Published): void {
  out(
    `${kind} ${result.id}  release ${result.release.number}  ${result.release.digest}  live ${result.live ?? "-"}`,
  );
}

type PublishFlags = BuilderFlags & {
  root?: string;
  package?: string[];
  agent?: string[];
  promote?: boolean;
  build?: boolean;
  wasm?: string[];
};

/**
 * `aomi publish`: build each package of the root `aomi.toml`, pack and check
 * it with `aomi-build-core`, upload it, then publish the root's agents;
 * `--promote` makes each new release live. Without
 * `--package` or `--agent` it publishes everything the root lists. Each
 * promote moves one pointer, so a failure part way names the pointers that
 * already moved. A package that fails is reported after the rest publish.
 */
export async function publish(flags: PublishFlags): Promise<void> {
  const root = resolve(flags.root ?? ".");
  const rootText = readFileSync(join(root, "aomi.toml"), "utf8");
  const manifest = toml(join(root, "aomi.toml"));
  const everything = !flags.package?.length && !flags.agent?.length;
  const wasm = new Map(
    (flags.wasm ?? []).map((entry) => {
      const at = entry.indexOf("=");
      if (at <= 0) throw usage(`--wasm takes <name>=<path>, not ${entry}`);
      return [entry.slice(0, at), resolve(entry.slice(at + 1))];
    }),
  );
  const moved: string[] = [];
  const bundles = mkdtempSync(join(tmpdir(), "aomi-bundles-"));
  try {
    // `aomi-build-core` reads each package's manifest, as publish does: a
    // first pack names the package, or says why it does not pack.
    const packages = ((manifest.packages ?? []) as { path: string }[]).map(
      ({ path }, index) => {
        const dir = join(root, inside(root, path));
        const bundle = join(bundles, `${index}.tar`);
        try {
          const packed = core<{ package: string }>([
            "pack",
            dir,
            "--out",
            bundle,
          ]);
          return { path, dir, bundle, name: packed.package };
        } catch (error) {
          return { path, dir, bundle, failure: messageOf(error) };
        }
      },
    );
    const agents = (manifest.agents ?? []) as {
      name: string;
      voice?: string;
    }[];
    const unpacked = packages.flatMap((entry) =>
      entry.failure ? [`${entry.path}: ${entry.failure}`] : [],
    );
    for (const name of flags.package ?? [])
      if (!packages.some((entry) => entry.name === name))
        throw usage(
          [`${name} is not a package of ${root}/aomi.toml`, ...unpacked].join(
            "\n",
          ),
        );
    for (const name of flags.agent ?? [])
      if (!agents.some((agent) => agent.name === name))
        throw usage(`${name} is not an agent of ${root}/aomi.toml`);

    const client = builder(flags);
    const results: Published[] = [];
    // One package's failure leaves the others to publish.
    const failed = everything ? unpacked : [];
    const goLive = async (
      kind: ReleaseKind,
      name: string,
      result: Published,
    ) => {
      if (!flags.promote || result.live === result.release.number) return;
      const { live } = await refused(
        client.promoteRelease({
          kind,
          name,
          number: result.release.number,
          expectedLive: result.live,
        }),
      );
      moved.push(
        `${kind} ${result.id}  live ${live} (was ${result.live ?? "-"})${result.live === null ? "" : `  undo: aomi rollback ${kind} ${name} ${result.live}`}`,
      );
      result.live = live;
    };

    for (const { name, dir, bundle } of packages) {
      if (!name || (!everything && !flags.package?.includes(name))) continue;
      // A package with no `src/` is text-only: it ships no component.
      const source = existsSync(join(dir, "src"));
      if (source && flags.build === false && !wasm.has(name))
        throw usage(`--no-build needs --wasm ${name}=<path>`);
      try {
        const built = wasm.get(name) ?? (source ? cargoBuild(dir) : undefined);
        // The Manager's own pack and release check, run here before upload.
        if (built) core(["pack", dir, "--wasm", built, "--out", bundle]);
        core(["check", bundle]);
        const result = await refused(
          client.publishPackage({
            name,
            bundle: readFileSync(bundle),
            sourceRepo: process.env.GITHUB_REPOSITORY,
            sourceCommit: process.env.GITHUB_SHA,
          }),
        );
        await goLive("package", name, result);
        results.push(result);
        if (!flags.json) print("package", result);
      } catch (error) {
        failed.push(`${name}: ${messageOf(error)}`);
      }
    }

    for (const agent of agents) {
      if (!everything && !flags.agent?.includes(agent.name)) continue;
      const files = agent.voice
        ? {
            [agent.voice]: readFileSync(
              join(root, inside(root, agent.voice)),
              "utf8",
            ),
          }
        : {};
      const result = await refused(
        client.publishAgent({ name: agent.name, root: rootText, files }),
      );
      await goLive("agent", agent.name, result);
      results.push(result);
      if (!flags.json) print("agent", result);
    }
    if (flags.json) for (const result of results) json(result);
    if (failed.length) throw new CliError(failed.join("\n"));
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
 * `aomi promote <package|agent> <name> <number>`: make a release live, and
 * `aomi rollback`, which takes the same explicit number: the release before
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

/** `aomi releases <package|agent> <name>`: newest first. */
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
 * `aomi codes create <package> [--agent <publisher/name>]`: a new activation
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

/** `aomi codes list <package>`: newest first, with how many hold each. */
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

/** `aomi codes revoke <package> <id>`: nobody can redeem it again, and everyone who did loses the package. */
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
