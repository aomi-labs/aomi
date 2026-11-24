import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { core } from "../build-core";
import {
  CliError,
  connect,
  json,
  messageOf,
  out,
  usage,
  type ConnectFlags,
} from "../context";

/** A project root as `aomi-build-core manifest` reads it. */
export type Project = {
  publisher: string;
  packages: { path: string; package?: string; error?: string }[];
  agents: { name: string; voice: string | null }[];
};

/** One listed package: its folder and name, or why it has none. */
type Listed = {
  path: string;
  dir: string;
  name?: string;
  failure?: string;
};

/** Where building a package stopped. */
export type Phase =
  | "manifest"
  | "build"
  | "pack"
  | "check"
  | "upload"
  | "promote";

/** How packages are built: `--no-build` and `--wasm <name>=<path>`. */
export type BuildFlags = { build?: boolean; wasm?: string[] };

type Packed = { digest: string };

/** The root's packages, each with its folder and name. */
export function packagesOf(root: string, project: Project): Listed[] {
  return project.packages.map(({ path, package: name, error }) => ({
    path,
    dir: join(root, path),
    name,
    failure: error,
  }));
}

/** `--package` names, each of which the root must list. */
export function selected(root: string, listed: Listed[], names: string[] = []) {
  for (const name of names)
    if (!listed.some((entry) => entry.name === name))
      throw usage(
        [
          `${name} is not a package of ${root}/aomi.toml`,
          ...listed.flatMap(({ path, failure }) =>
            failure ? [`${path}: ${failure}`] : [],
          ),
        ].join("\n"),
      );
  return listed.filter(
    ({ name }) => name && (!names.length || names.includes(name)),
  );
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

/**
 * Builds a package with cargo unless it is text-only (no `src/`), then
 * packs and checks it to `out` with `aomi-build-core`, as the Manager does
 * at publish.
 */
export function bundle(
  { dir, name }: { dir: string; name: string },
  flags: BuildFlags,
  out: string,
  at: (phase: Phase) => void = () => {},
): Packed {
  const wasm = new Map(
    (flags.wasm ?? []).map((entry) => {
      const sign = entry.indexOf("=");
      if (sign <= 0) throw usage(`--wasm takes <name>=<path>, not ${entry}`);
      return [entry.slice(0, sign), resolve(entry.slice(sign + 1))];
    }),
  );
  at("build");
  const source = existsSync(join(dir, "src"));
  if (source && flags.build === false && !wasm.has(name))
    throw usage(`--no-build needs --wasm ${name}=<path>`);
  // `onchain!()` compiles `generated/descriptor.json`: refresh it from
  // `aomi.toml` first, so the build never targets old contracts.
  if (
    source &&
    !wasm.has(name) &&
    existsSync(join(dir, "generated/descriptor.json"))
  )
    core(["gen", dir]);
  const built = wasm.get(name) ?? (source ? cargoBuild(dir) : undefined);
  at("pack");
  const packed = core<Packed>([
    "pack",
    dir,
    ...(built ? ["--wasm", built] : []),
    "--out",
    out,
  ]);
  at("check");
  core(["check", out]);
  return packed;
}

type Each = BuildFlags & { root?: string; package?: string[]; json?: boolean };

/**
 * Runs `step` on each selected package of the root, reports each as it
 * finishes, and fails after the rest with every failure.
 */
function each(
  flags: Each,
  step: (entry: { dir: string; name: string }) => object,
) {
  const root = resolve(flags.root ?? ".");
  const listed = packagesOf(root, core<Project>(["manifest", root]));
  const failed = flags.package?.length
    ? []
    : listed.flatMap(({ path, failure }) =>
        failure ? [`${path}: ${failure}`] : [],
      );
  for (const entry of selected(root, listed, flags.package)) {
    const name = entry.name!;
    try {
      const result = { package: name, ...step({ dir: entry.dir, name }) };
      if (flags.json) json(result);
      else out(Object.values(result).join("  "));
    } catch (error) {
      failed.push(`${name}: ${messageOf(error)}`);
    }
  }
  if (failed.length) throw new CliError(failed.join("\n"));
}

/** `aomi build pack`: each package's bundle in `--out`, checked. */
export async function pack(flags: Each & { out?: string }): Promise<void> {
  const dir = resolve(flags.out ?? ".");
  mkdirSync(dir, { recursive: true });
  each(flags, (entry) => {
    const out = join(dir, `${entry.name}.tar`);
    return { out, digest: bundle(entry, flags, out).digest };
  });
}

/**
 * `aomi build test`: the build, pack and check publish runs, then each
 * package's own `cargo test` when it has code.
 */
export async function test(flags: Each): Promise<void> {
  const bundles = mkdtempSync(join(tmpdir(), "aomi-test-"));
  try {
    each(flags, (entry) => {
      const out = join(bundles, `${entry.name}.tar`);
      const { digest } = bundle(entry, flags, out);
      if (existsSync(join(entry.dir, "src")))
        execFileSync("cargo", ["test"], {
          cwd: entry.dir,
          stdio: ["ignore", 2, 2],
        });
      return { result: "ok", digest };
    });
  } finally {
    rmSync(bundles, { recursive: true, force: true });
  }
}

type Finding = { level: string; subject: string; message: string };

/** `aomi build doctor [path]`: the server's checks, without building. */
export async function doctor(
  flags: { json?: boolean },
  path = ".",
): Promise<void> {
  const report = core<{ ok: boolean; findings: Finding[] }>([
    "doctor",
    resolve(path),
  ]);
  if (flags.json) json(report);
  else
    for (const { level, subject, message } of report.findings)
      out(`${level}  ${subject}  ${message}`);
  if (!report.ok) throw new CliError("doctor found errors");
  if (!flags.json && !report.findings.length) out("ok");
}

/** Prints the core's answer: JSON, or each value on one line. */
function show(flags: { json?: boolean }, answer: Record<string, unknown>) {
  if (flags.json) return json(answer);
  const text = (value: unknown): string =>
    value && typeof value === "object"
      ? Object.values(value).map(text).join("  ")
      : String(value);
  out(text(answer));
}

/** `aomi build init [dir] --publisher <slug>`: a project and its first package. */
export async function init(
  flags: { publisher: string; name?: string; json?: boolean },
  dir = ".",
): Promise<void> {
  const name = flags.name ? ["--name", flags.name] : [];
  show(
    flags,
    core(["init", resolve(dir), "--publisher", flags.publisher, ...name]),
  );
}

/** `aomi build new package|agent <name>`. */
export function create(kind: "package" | "agent") {
  return async (flags: { root?: string; json?: boolean }, name: string) =>
    show(
      flags,
      core(["new", kind, name, "--root", resolve(flags.root ?? ".")]),
    );
}

/** `aomi build tool add <name>`: a tool stub in the package's `src/lib.rs`. */
export async function addTool(
  flags: { package?: string; json?: boolean },
  name: string,
): Promise<void> {
  show(
    flags,
    core(["tool", "add", name, "--package", resolve(flags.package ?? ".")]),
  );
}

/** `aomi build gen`: `generated/` from the package's `[onchain]` sections. */
export async function gen(flags: {
  package?: string;
  json?: boolean;
}): Promise<void> {
  show(flags, core(["gen", resolve(flags.package ?? ".")]));
}

type ContractFlags = ConnectFlags & {
  package?: string;
  file?: string;
  address?: string[];
  json?: boolean;
};

/**
 * `aomi build contracts add <label> [address]`: the ABI or IDL from
 * Aomi's registry (`--chain` for an EVM address, none for a Solana
 * program), or `--file`, written into the package with an
 * `[onchain.<label>]` stub.
 */
export async function addContract(
  flags: ContractFlags,
  label: string,
  address?: string,
): Promise<void> {
  if (!flags.file === !address)
    throw usage("Pass an address to look up, or --file");
  const deployments = (flags.address ?? []).flatMap((a) => ["--address", a]);
  const args = [
    "contracts",
    "add",
    label,
    ...deployments,
    "--package",
    resolve(flags.package ?? "."),
  ];
  if (flags.file)
    return show(flags, core([...args, "--file", resolve(flags.file)]));
  const evm = address!.startsWith("0x");
  if (evm && flags.chain === undefined)
    throw usage("--chain <id> names the EVM chain to look the address up on");
  const aomi = await connect(flags);
  const { result } = await aomi.pipeline.invoke<{
    result: unknown;
  }>(
    evm ? "evm_get_contract" : "svm_get_program",
    // Both schemas want every key: the EVM one takes "" for "any", the
    // Solana one null.
    evm
      ? {
          address,
          chain_id: flags.chain,
          mode: "abi",
          auto_resolve_proxy: true,
          function: "",
          symbol: "",
          name: "",
          protocol: "",
          contract_type: "",
          version: "",
        }
      : {
          program_id: address,
          mode: "idl",
          name: null,
          framework: null,
          instruction: null,
        },
  );
  const dir = mkdtempSync(join(tmpdir(), "aomi-lookup-"));
  try {
    const lookup = join(dir, "lookup.json");
    writeFileSync(lookup, JSON.stringify(result));
    show(flags, core([...args, "--lookup", lookup]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
