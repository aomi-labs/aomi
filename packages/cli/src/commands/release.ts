import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, join, normalize, resolve } from "node:path";
import {
  ManagerClient,
  rejectionOf,
  type Published,
  type ReleaseKind,
} from "@aomi-labs/internal/manager";
import { parse } from "toml";
import { CliError, json, out, usage } from "../context";

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
 * `aomi publish`: build and upload each package of the root `aomi.toml`, then
 * publish its agents; `--promote` makes each new release live. Without
 * `--package` or `--agent` it publishes everything the root lists.
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
  const packages = ((manifest.packages ?? []) as { path: string }[]).map(
    ({ path }) => {
      const dir = join(root, inside(root, path));
      const config = toml(join(dir, "aomi.toml")).package ?? {};
      return { dir, name: String(config.name ?? ""), config };
    },
  );
  const agents = (manifest.agents ?? []) as { name: string; voice?: string }[];
  for (const name of flags.package ?? [])
    if (!packages.some((entry) => entry.name === name))
      throw usage(`${name} is not a package of ${root}/aomi.toml`);
  for (const name of flags.agent ?? [])
    if (!agents.some((agent) => agent.name === name))
      throw usage(`${name} is not an agent of ${root}/aomi.toml`);

  const client = builder(flags);
  const results: Published[] = [];
  const goLive = async (kind: ReleaseKind, name: string, result: Published) => {
    if (!flags.promote || result.live === result.release.number) return;
    const { live } = await refused(
      client.promoteRelease({
        kind,
        name,
        number: result.release.number,
        expectedLive: result.live,
      }),
    );
    result.live = live;
  };

  for (const entry of packages) {
    if (!everything && !flags.package?.includes(entry.name)) continue;
    const built =
      wasm.get(entry.name) ??
      (flags.build === false ? undefined : cargoBuild(entry.dir));
    if (!built) throw usage(`--no-build needs --wasm ${entry.name}=<path>`);
    const { icon, guards, skills = [] } = entry.config;
    const listed = [
      icon,
      ...(skills as { path: string }[]).map((skill) => skill.path),
      guards,
    ].filter((path): path is string => typeof path === "string");
    const members: [string, Uint8Array][] = [
      ["aomi.toml", readFileSync(join(entry.dir, "aomi.toml"))],
      ["package.wasm", readFileSync(built)],
      ...listed.map((path): [string, Uint8Array] => {
        const member = inside(entry.dir, path);
        return [member, readFileSync(join(entry.dir, member))];
      }),
    ];
    const result = await refused(
      client.publishPackage({
        name: entry.name,
        bundle: tar(members),
        sourceRepo: process.env.GITHUB_REPOSITORY,
        sourceCommit: process.env.GITHUB_SHA,
      }),
    );
    await goLive("package", entry.name, result);
    results.push(result);
    if (!flags.json) print("package", result);
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
}

/** `aomi promote <package|agent> <name> <number>`: make a release live. */
export async function promote(
  flags: BuilderFlags,
  kind: string,
  name: string,
  number: string,
): Promise<void> {
  await move(flags, kindOf(kind), name, numberOf(number));
}

/** `aomi rollback <package|agent> <name> [<number>]`: by default, the release before the live one. */
export async function rollback(
  flags: BuilderFlags,
  kind: string,
  name: string,
  number?: string,
): Promise<void> {
  await move(flags, kindOf(kind), name, number ? numberOf(number) : undefined);
}

async function move(
  flags: BuilderFlags,
  kind: ReleaseKind,
  name: string,
  number?: number,
): Promise<void> {
  const client = builder(flags);
  const { live, releases } = await refused(client.listReleases({ kind, name }));
  const target =
    number ??
    Math.max(
      ...releases
        .map((release) => release.number)
        .filter((candidate) => live !== null && candidate < live),
    );
  if (!Number.isSafeInteger(target))
    throw usage(
      live === null
        ? `${name} has no live release`
        : `${name} has no release before ${live}`,
    );
  const result = await refused(
    client.promoteRelease({ kind, name, number: target, expectedLive: live }),
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
