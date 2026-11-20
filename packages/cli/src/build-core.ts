import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { CliError, messageOf } from "./context";

/**
 * `aomi-build-core`: `AOMI_BUILD_CORE`, else the binary that the platform's
 * optional dependency installed with the CLI (D13).
 */
function binary(): string {
  const path = process.env.AOMI_BUILD_CORE;
  if (path) return path;
  const name = `@aomi-labs/build-core-${process.platform}-${process.arch}`;
  const file =
    process.platform === "win32" ? "aomi-build-core.exe" : "aomi-build-core";
  try {
    return createRequire(import.meta.url).resolve(`${name}/bin/${file}`);
  } catch {
    throw new CliError(
      `aomi-build-core is missing: reinstall the CLI with optional dependencies (${name}), or set AOMI_BUILD_CORE`,
    );
  }
}

/**
 * Runs one command of the Rust binary that knows what a package is, and
 * returns its JSON answer. A refusal throws as `code: message`.
 */
export function core<T>(args: string[]): T {
  const executable = binary();
  let stdout: string;
  try {
    stdout = execFileSync(executable, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    });
  } catch (error) {
    const answer = (error as { stdout?: string }).stdout;
    const refusal = answer?.startsWith("{")
      ? (JSON.parse(answer) as { error?: { code: string; message: string } })
          .error
      : undefined;
    if (refusal) throw new CliError(`${refusal.code}: ${refusal.message}`);
    throw new CliError(`aomi-build-core ${args[0]}: ${messageOf(error)}`);
  }
  return JSON.parse(stdout) as T;
}
