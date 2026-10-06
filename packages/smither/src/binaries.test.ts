import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ensureFreshSdkCheckout,
  resolveAomiBinaries,
  targetBinaryPaths,
} from "../binaries";
import type { CommandRunner } from "../types";

describe("resolveAomiBinaries", () => {
  it("builds fresh SDK binaries before using target paths", async () => {
    const sdkRoot = await mkdtemp(path.join(os.tmpdir(), "aomi-sdk-"));
    const calls: string[] = [];
    const runner: CommandRunner = async (file, args) => {
      calls.push([file, ...args].join(" "));
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    const resolved = await resolveAomiBinaries(sdkRoot, runner);

    expect(resolved.source).toBe("fresh-cargo-build");
    expect(resolved.aomiBuild).toBe(targetBinaryPaths(sdkRoot).aomiBuild);
    expect(calls[0]).toContain("cargo build --manifest-path");
    expect(calls[0]).toContain("--features cli,dev-runtime --bins --release");
  });

  it("refuses stale fallbacks unless explicitly allowed", async () => {
    const sdkRoot = await mkdtemp(path.join(os.tmpdir(), "aomi-sdk-"));
    const bins = targetBinaryPaths(sdkRoot);
    await mkdir(path.dirname(bins.aomiBuild), { recursive: true });
    await writeFile(bins.aomiBuild, "");
    await writeFile(bins.aomiRun, "");
    const runner: CommandRunner = async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "cargo missing",
    });

    await expect(resolveAomiBinaries(sdkRoot, runner)).rejects.toThrow(/--allow-stale-sdk/);
  });

  it("falls back to existing target binaries with a drift warning when allowed", async () => {
    const sdkRoot = await mkdtemp(path.join(os.tmpdir(), "aomi-sdk-"));
    const bins = targetBinaryPaths(sdkRoot);
    await mkdir(path.dirname(bins.aomiBuild), { recursive: true });
    await writeFile(bins.aomiBuild, "");
    await writeFile(bins.aomiRun, "");

    const runner: CommandRunner = async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "cargo missing",
    });

    const resolved = await resolveAomiBinaries(sdkRoot, runner, { allowStale: true });

    expect(resolved.source).toBe("stale-target-fallback");
    expect(resolved.warning).toContain("may lag the checkout");
  });

  it("falls back to PATH binaries after target fallback is unavailable when allowed", async () => {
    const sdkRoot = await mkdtemp(path.join(os.tmpdir(), "aomi-sdk-"));
    const runner: CommandRunner = async (file) => ({
      exitCode: file === "cargo" ? 1 : 0,
      stdout: "",
      stderr: "",
    });

    const resolved = await resolveAomiBinaries(sdkRoot, runner, { allowStale: true });

    expect(resolved.source).toBe("path-fallback");
    expect(resolved.warning).toContain("PATH binaries");
  });
});

/** Scripted git runner: responds by matching the subcommand sequence. */
function gitRunner(script: Record<string, { exitCode?: number; stdout?: string; stderr?: string }>): {
  runner: CommandRunner;
  calls: string[];
} {
  const calls: string[] = [];
  const runner: CommandRunner = async (file, args) => {
    const command = [file, ...args].join(" ");
    calls.push(command);
    const match = Object.entries(script).find(([key]) => command.includes(key));
    const spec = match?.[1] ?? {};
    return {
      exitCode: spec.exitCode ?? 0,
      stdout: spec.stdout ?? "",
      stderr: spec.stderr ?? "",
    };
  };
  return { runner, calls };
}

describe("ensureFreshSdkCheckout", () => {
  it("reports up-to-date without merging", async () => {
    const { runner, calls } = gitRunner({
      "symbolic-ref": { stdout: "refs/remotes/origin/main\n" },
      "rev-list --count HEAD..origin/main": { stdout: "0\n" },
      "rev-parse HEAD": { stdout: "abc123\n" },
    });

    const freshness = await ensureFreshSdkCheckout("/sdk", runner);

    expect(freshness.action).toBe("up-to-date");
    expect(freshness.headSha).toBe("abc123");
    expect(calls.join("\n")).not.toContain("merge");
  });

  it("fast-forwards a clean checkout that is behind origin", async () => {
    const { runner, calls } = gitRunner({
      "symbolic-ref": { stdout: "refs/remotes/origin/main\n" },
      "rev-list --count HEAD..origin/main": { stdout: "3\n" },
      "rev-list --count origin/main..HEAD": { stdout: "0\n" },
      "status --porcelain": { stdout: "" },
      "rev-parse HEAD": { stdout: "def456\n" },
    });

    const freshness = await ensureFreshSdkCheckout("/sdk", runner);

    expect(freshness.action).toBe("fast-forwarded");
    expect(calls.join("\n")).toContain("merge --ff-only origin/main");
  });

  it("throws when behind with tracked modifications", async () => {
    const { runner } = gitRunner({
      "symbolic-ref": { stdout: "refs/remotes/origin/main\n" },
      "rev-list --count HEAD..origin/main": { stdout: "2\n" },
      "status --porcelain --untracked-files=no": { stdout: " M sdk/src/lib.rs\n" },
      "rev-parse HEAD": { stdout: "abc\n" },
    });

    await expect(ensureFreshSdkCheckout("/sdk", runner)).rejects.toThrow(
      /uncommitted changes/,
    );
  });

  it("fast-forwards past untracked files (generated apps, .smithers state)", async () => {
    const { runner, calls } = gitRunner({
      "symbolic-ref": { stdout: "refs/remotes/origin/main\n" },
      "rev-list --count HEAD..origin/main": { stdout: "1\n" },
      "rev-list --count origin/main..HEAD": { stdout: "0\n" },
      // tracked-only status is clean; plain status would show ?? entries
      "status --porcelain --untracked-files=no": { stdout: "" },
      "rev-parse HEAD": { stdout: "fff111\n" },
    });

    const freshness = await ensureFreshSdkCheckout("/sdk", runner);

    expect(freshness.action).toBe("fast-forwarded");
    expect(calls.join("\n")).toContain("status --porcelain --untracked-files=no");
  });

  it("throws when fetch fails, unless stale is allowed", async () => {
    const { runner } = gitRunner({
      fetch: { exitCode: 1, stderr: "could not resolve host github.com" },
      "rev-parse HEAD": { stdout: "abc\n" },
    });

    await expect(ensureFreshSdkCheckout("/sdk", runner)).rejects.toThrow(/git fetch origin failed/);

    const allowed = await ensureFreshSdkCheckout("/sdk", runner, { allowStale: true });
    expect(allowed.action).toBe("fetch-failed");
    expect(allowed.warning).toContain("possibly stale SDK");
  });

  it("refuses to rewrite local commits (diverged checkout)", async () => {
    const { runner, calls } = gitRunner({
      "symbolic-ref": { stdout: "refs/remotes/origin/main\n" },
      "rev-list --count HEAD..origin/main": { stdout: "2\n" },
      "rev-list --count origin/main..HEAD": { stdout: "1\n" },
      "status --porcelain": { stdout: "" },
      "rev-parse HEAD": { stdout: "abc\n" },
    });

    await expect(ensureFreshSdkCheckout("/sdk", runner)).rejects.toThrow(/local commits/);
    expect(calls.join("\n")).not.toContain("merge --ff-only");
  });
});
