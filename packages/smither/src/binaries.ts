import { access } from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import type { CommandResult, CommandRunner, ResolvedBinaries } from "./types";

const executable = process.platform === "win32" ? ".exe" : "";

export const defaultRunner: CommandRunner = async (file, args, options) => {
  const child = execa(file, args, {
    cwd: options?.cwd,
    env: options?.env,
    stdin: options?.stdin,
    reject: false,
    all: false,
  });

  const command = [file, ...args].join(" ");
  child.stdout?.on("data", (chunk: Buffer | string) => {
    options?.onOutput?.({
      stream: "stdout",
      data: chunk.toString(),
      command,
    });
  });
  child.stderr?.on("data", (chunk: Buffer | string) => {
    options?.onOutput?.({
      stream: "stderr",
      data: chunk.toString(),
      command,
    });
  });

  const result = await child;
  return {
    exitCode: result.exitCode ?? 0,
    stdout: result.stdout,
    stderr: result.stderr,
  };
};

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

export function defaultSdkRoot(cwd = process.cwd()): string {
  return path.resolve(cwd, "../aomi-sdk");
}

export function targetBinaryPaths(sdkRoot: string): Pick<ResolvedBinaries, "aomiBuild" | "aomiRun"> {
  return {
    aomiBuild: path.join(sdkRoot, "target", "release", `aomi-build${executable}`),
    aomiRun: path.join(sdkRoot, "target", "release", `aomi-run${executable}`),
  };
}

export type SdkFreshness = {
  /** HEAD after any sync, or null when the checkout is not a git repo. */
  headSha: string | null;
  action:
    | "image"
    | "up-to-date"
    | "fast-forwarded"
    | "not-git"
    | "fetch-failed"
    | "stale-dirty"
    | "stale-diverged";
  warning?: string;
};

async function git(
  sdkRoot: string,
  args: string[],
  runner: CommandRunner,
): Promise<CommandResult> {
  return runner("git", args, { cwd: sdkRoot });
}

async function remoteHeadRef(sdkRoot: string, runner: CommandRunner): Promise<string | null> {
  const symbolic = await git(
    sdkRoot,
    ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
    runner,
  );
  if (symbolic.exitCode === 0) {
    const ref = symbolic.stdout.trim().replace("refs/remotes/", "");
    if (ref) return ref;
  }
  for (const candidate of ["origin/main", "origin/master"]) {
    const verify = await git(sdkRoot, ["rev-parse", "--verify", "--quiet", candidate], runner);
    if (verify.exitCode === 0) return candidate;
  }
  return null;
}

/**
 * Guarantee the SDK checkout matches GitHub before binaries are built from it:
 * fetch origin, and fast-forward a clean checkout that is strictly behind.
 * Anything that prevents the guarantee (no git, offline, dirty tree, local
 * commits) throws unless `allowStale` — binaries must not silently lag origin.
 */
export async function ensureFreshSdkCheckout(
  sdkRoot: string,
  runner: CommandRunner = defaultRunner,
  options: { allowStale?: boolean } = {},
): Promise<SdkFreshness> {
  const allowStale = options.allowStale ?? false;
  const resolvedRoot = path.resolve(sdkRoot);
  const stale = (freshness: SdkFreshness, reason: string): SdkFreshness => {
    if (allowStale) {
      return { ...freshness, warning: `${reason} — continuing with a possibly stale SDK (--allow-stale-sdk)` };
    }
    throw new Error(
      `${reason}. aomi-smither builds binaries from a GitHub-fresh SDK checkout; fix the checkout at ${resolvedRoot} or pass --allow-stale-sdk to override.`,
    );
  };

  const isRepo = await git(resolvedRoot, ["rev-parse", "--is-inside-work-tree"], runner);
  if (isRepo.exitCode !== 0) {
    return stale({ headSha: null, action: "not-git" }, "SDK checkout is not a git repository");
  }

  const headOf = async () =>
    (await git(resolvedRoot, ["rev-parse", "HEAD"], runner)).stdout.trim() || null;

  const fetch = await git(resolvedRoot, ["fetch", "--quiet", "origin"], runner);
  if (fetch.exitCode !== 0) {
    return stale(
      { headSha: await headOf(), action: "fetch-failed" },
      `git fetch origin failed for the SDK checkout (${fetch.stderr.trim() || "network error"})`,
    );
  }

  const remoteRef = await remoteHeadRef(resolvedRoot, runner);
  if (!remoteRef) {
    return stale(
      { headSha: await headOf(), action: "fetch-failed" },
      "could not resolve origin's default branch for the SDK checkout",
    );
  }

  const behind = await git(resolvedRoot, ["rev-list", "--count", `HEAD..${remoteRef}`], runner);
  const behindCount = Number(behind.stdout.trim() || "0");
  if (behindCount === 0) {
    return { headSha: await headOf(), action: "up-to-date" };
  }

  // Untracked files (generated apps, the engine's own .smithers/ state) never
  // block a fast-forward — git aborts on its own if one would be clobbered.
  const status = await git(
    resolvedRoot,
    ["status", "--porcelain", "--untracked-files=no"],
    runner,
  );
  if (status.stdout.trim() !== "") {
    return stale(
      { headSha: await headOf(), action: "stale-dirty" },
      `SDK checkout is ${behindCount} commit(s) behind ${remoteRef} with uncommitted changes`,
    );
  }

  const ahead = await git(resolvedRoot, ["rev-list", "--count", `${remoteRef}..HEAD`], runner);
  if (Number(ahead.stdout.trim() || "0") > 0) {
    return stale(
      { headSha: await headOf(), action: "stale-diverged" },
      `SDK checkout has local commits and is behind ${remoteRef}`,
    );
  }

  const merge = await git(resolvedRoot, ["merge", "--ff-only", remoteRef], runner);
  if (merge.exitCode !== 0) {
    return stale(
      { headSha: await headOf(), action: "stale-diverged" },
      `fast-forward to ${remoteRef} failed (${merge.stderr.trim()})`,
    );
  }
  return { headSha: await headOf(), action: "fast-forwarded" };
}

export async function resolveAomiBinaries(
  sdkRoot: string,
  runner: CommandRunner = defaultRunner,
  options: { allowStale?: boolean } = {},
): Promise<ResolvedBinaries> {
  const allowStale = options.allowStale ?? false;
  const resolvedRoot = path.resolve(sdkRoot);
  const bins = targetBinaryPaths(resolvedRoot);
  const manifest = path.join(resolvedRoot, "sdk", "Cargo.toml");
  const cargoArgs = [
    "build",
    "--manifest-path",
    manifest,
    "--features",
    "cli,dev-runtime",
    "--bins",
    "--release",
  ];

  const cargo = await runner("cargo", cargoArgs, { cwd: resolvedRoot });
  if (cargo.exitCode === 0) {
    return { ...bins, sdkRoot: resolvedRoot, source: "fresh-cargo-build" };
  }

  // The fallbacks below hand out binaries that may lag the checkout, which
  // breaks the fresh-from-GitHub guarantee — only reachable with allowStale.
  if (allowStale) {
    if ((await fileExists(bins.aomiBuild)) && (await fileExists(bins.aomiRun))) {
      return {
        ...bins,
        sdkRoot: resolvedRoot,
        source: "stale-target-fallback",
        warning:
          "cargo build failed; using existing target/release binaries, which may lag the checkout",
      };
    }

    const pathBuild = await runner(`aomi-build${executable}`, ["--help"]);
    const pathRun = await runner(`aomi-run${executable}`, ["--help"]);
    if (pathBuild.exitCode === 0 && pathRun.exitCode === 0) {
      return {
        aomiBuild: `aomi-build${executable}`,
        aomiRun: `aomi-run${executable}`,
        sdkRoot: resolvedRoot,
        source: "path-fallback",
        warning:
          "cargo build failed; using PATH binaries, which may drift from the selected SDK checkout",
      };
    }
  }

  throw new Error(
    `Could not build aomi-build/aomi-run from the SDK checkout. Install Rust or fix the build${allowStale ? "" : ", or pass --allow-stale-sdk to fall back to existing binaries"}.\n\ncargo stderr:\n${cargo.stderr}`,
  );
}

/** Freshness + build in one step: sync the checkout with GitHub, then build
 *  binaries from it. This is the only binaries entry point the workflow uses. */
export async function resolveFreshAomiBinaries(
  sdkRoot: string,
  runner: CommandRunner = defaultRunner,
  options: { allowStale?: boolean } = {},
): Promise<ResolvedBinaries & { freshness: SdkFreshness }> {
  // The runner image already compiled these tools from this exact checkout.
  const imageRevision = process.env.AOMI_RUNNER_SDK_REVISION;
  if (imageRevision && sdkRoot === process.env.AOMI_SDK_ROOT) {
    const head = await git(sdkRoot, ["rev-parse", "HEAD"], runner);
    const bins = targetBinaryPaths(sdkRoot);
    if (head.exitCode !== 0 || head.stdout.trim() !== imageRevision ||
        !(await fileExists(bins.aomiBuild)) || !(await fileExists(bins.aomiRun))) {
      throw new Error("Runner SDK checkout and prebuilt binaries do not match the image");
    }
    return { ...bins, sdkRoot, source: "runner-image", freshness: { headSha: imageRevision, action: "image" } };
  }
  const freshness = await ensureFreshSdkCheckout(sdkRoot, runner, options);
  const binaries = await resolveAomiBinaries(sdkRoot, runner, options);
  const warning = [freshness.warning, binaries.warning].filter(Boolean).join("; ");
  return { ...binaries, ...(warning ? { warning } : {}), freshness };
}
