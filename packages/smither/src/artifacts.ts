import { execFile } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CommandRunner } from "./types";

/**
 * Crate artifact packaging for the result phase. The generated package's file
 * tree and a small tarball ride the durable result row, so surfaces that
 * cannot see the run's filesystem (the web BFF observing a sandbox run)
 * still serve real Files and Download.
 */

export type CrateFileNode = {
  path: string;
  type: "file" | "folder";
  children?: CrateFileNode[];
};

const TREE_SKIP = new Set(["target", "node_modules", ".git", "Cargo.lock"]);

/** The generated crate as a display tree. Paths are prefixed with the package
 *  name ("<package>/src/tool.rs") — the shape the /build page renders. */
export function crateFileTree(
  appDir: string,
  packageName: string,
): CrateFileNode[] {
  const walk = (dir: string, rel: string, depth: number): CrateFileNode[] => {
    if (depth > 4) return [];
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter((e) => !TREE_SKIP.has(e.name) && !e.name.startsWith("."))
      .sort((a, b) =>
        a.isDirectory() === b.isDirectory()
          ? a.name.localeCompare(b.name)
          : a.isDirectory()
            ? -1
            : 1,
      )
      .map((e) => {
        const childRel = `${rel}/${e.name}`;
        return e.isDirectory()
          ? {
              path: childRel,
              type: "folder" as const,
              children: walk(path.join(dir, e.name), childRel, depth + 1),
            }
          : { path: childRel, type: "file" as const };
      });
  };
  if (!existsSync(appDir)) return [];
  return [
    {
      path: packageName,
      type: "folder",
      children: walk(appDir, packageName, 0),
    },
  ];
}

/** Keep the embedded tarball comfortably under the run's maxOutputBytes
 *  (executeRun raises it to 4 MB for exactly this row). */
const MAX_TAR_B64_CHARS = 2_500_000;

/** Plain child_process runner — packaging is a local tar spawn and must not
 *  depend on the heavier workflow runner stack. Injectable for tests/TUI. */
const localRunner: CommandRunner = (file, args, options) =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      { cwd: options?.cwd, env: options?.env, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const exitCode =
          error && typeof (error as { code?: unknown }).code === "number"
            ? (error as { code: number }).code
            : error
              ? 1
              : 0;
        resolve({ exitCode, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });

export type CrateArtifact = {
  /** JSON-encoded CrateFileNode[]; "" when the crate directory is absent. */
  fileTreeJson: string;
  /** Base64 .tar.gz of packages/<package> (target/ and Cargo.lock excluded); "" when
   *  packaging failed or the crate exceeds the embed cap. */
  crateTarB64: string;
  /** Human-readable reason whenever crateTarB64 is empty. */
  warning: string;
};

export async function packageCrate(options: {
  sdkRoot: string;
  packageName: string;
  runner?: CommandRunner;
}): Promise<CrateArtifact> {
  const appsDir = path.join(options.sdkRoot, "packages");
  const appDir = path.join(appsDir, options.packageName);
  if (!existsSync(appDir)) {
    return {
      fileTreeJson: "",
      crateTarB64: "",
      warning: `no generated crate at packages/${options.packageName}`,
    };
  }
  const fileTreeJson = JSON.stringify(
    crateFileTree(appDir, options.packageName),
  );
  const runner = options.runner ?? localRunner;
  const tmp = mkdtempSync(path.join(tmpdir(), "aomi-crate-"));
  const tarPath = path.join(tmp, `${options.packageName}.tar.gz`);
  try {
    const tar = await runner("tar", [
      "-czf",
      tarPath,
      "--exclude",
      "target",
      "--exclude",
      "Cargo.lock",
      "-C",
      appsDir,
      options.packageName,
    ]);
    if (tar.exitCode !== 0) {
      return {
        fileTreeJson,
        crateTarB64: "",
        warning: `tar failed: ${(tar.stderr || tar.stdout).slice(0, 300)}`,
      };
    }
    const crateTarB64 = readFileSync(tarPath).toString("base64");
    if (crateTarB64.length > MAX_TAR_B64_CHARS) {
      return {
        fileTreeJson,
        crateTarB64: "",
        warning: `crate too large to embed (${crateTarB64.length} base64 chars > ${MAX_TAR_B64_CHARS})`,
      };
    }
    return { fileTreeJson, crateTarB64, warning: "" };
  } catch (error) {
    return {
      fileTreeJson,
      crateTarB64: "",
      warning: `packaging failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
