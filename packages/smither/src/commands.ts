import path from "node:path";
import type { CommandRunner, ResolvedBinaries } from "./types";
import { defaultRunner } from "./binaries";

export type AomiBuildCommand =
  | "gen-specs"
  | "gen-client"
  | "gen-tool"
  | "new-package";

export async function runAomiBuild(
  binaries: ResolvedBinaries,
  command: AomiBuildCommand,
  args: string[] = [],
  runner: CommandRunner = defaultRunner,
  env?: NodeJS.ProcessEnv,
) {
  return runner(binaries.aomiBuild, [command, ...args], {
    cwd: binaries.sdkRoot,
    ...(env ? { env } : {}),
  });
}

export async function runPackageCargoChecks(
  sdkRoot: string,
  packageName: string,
  runner: CommandRunner = defaultRunner,
) {
  // Packages are `exclude`d from the SDK root workspace (package-local mode), so
  // `-p <package>` at the root never resolves; target the package's own manifest.
  const manifest = path.join(sdkRoot, "packages", packageName, "Cargo.toml");
  const fmt = await runner("cargo", ["fmt", "--manifest-path", manifest], {
    cwd: sdkRoot,
  });
  if (fmt.exitCode !== 0) {
    return fmt;
  }

  const clippy = await runner(
    "cargo",
    ["clippy", "--manifest-path", manifest, "--lib", "--", "-Dwarnings"],
    { cwd: sdkRoot },
  );
  if (clippy.exitCode !== 0) {
    return clippy;
  }

  return runner("cargo", ["test", "--manifest-path", manifest, "--no-run"], {
    cwd: sdkRoot,
  });
}

export function newPackageArgs(input: {
  packageName: string;
  source: "discover" | "url" | "existing";
  openApiUrl?: string;
  shared: boolean;
  includeAllOperations: boolean;
  force: boolean;
  build: boolean;
}): string[] {
  if (input.source === "existing") {
    return [
      "gen-client",
      input.packageName,
      ...(input.shared ? ["--shared"] : []),
      ...(input.force ? ["--force"] : []),
    ];
  }

  // Always `--all`: without it aomi-build opens an interactive operation
  // picker, which dies under the workflow runner (no TTY). The agent
  // curation step prunes the tool surface afterwards.
  return [
    "new-package",
    input.packageName,
    ...(input.openApiUrl ? ["--from-url", input.openApiUrl] : []),
    ...(input.shared ? ["--shared"] : []),
    "--all",
    ...(input.force ? ["--force"] : []),
    ...(input.build ? [] : ["--no-build"]),
  ];
}
