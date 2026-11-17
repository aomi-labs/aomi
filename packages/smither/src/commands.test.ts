import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  newPackageArgs,
  runAomiBuild,
  runPackageCargoChecks,
} from "./commands";
import type { CommandRunner, ResolvedBinaries } from "./types";

describe("commands", () => {
  it("constructs new-package args", () => {
    expect(
      newPackageArgs({
        packageName: "demo",
        source: "url",
        openApiUrl: "https://example.com/openapi.json",
        shared: true,
        includeAllOperations: true,
        force: true,
        build: false,
      }),
    ).toEqual([
      "new-package",
      "demo",
      "--from-url",
      "https://example.com/openapi.json",
      "--shared",
      "--all",
      "--force",
      "--no-build",
    ]);
  });

  it("always exposes all operations (no TTY for the interactive picker)", () => {
    expect(
      newPackageArgs({
        packageName: "demo",
        source: "url",
        openApiUrl: "https://example.com/openapi.json",
        shared: false,
        includeAllOperations: false,
        force: false,
        build: true,
      }),
    ).toContain("--all");
  });

  it("runs aomi-build from the selected SDK root", async () => {
    const calls: unknown[] = [];
    const runner: CommandRunner = async (file, args, options) => {
      calls.push({ file, args, options });
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    const binaries: ResolvedBinaries = {
      aomiBuild: "/sdk/target/release/aomi-build",
      sdkRoot: "/sdk",
      source: "fresh-cargo-build",
    };

    await runAomiBuild(binaries, "status", ["--path", "/sdk"], runner);

    expect(calls).toEqual([
      {
        file: "/sdk/target/release/aomi-build",
        args: ["status", "--path", "/sdk"],
        options: { cwd: "/sdk" },
      },
    ]);
  });

  it("scopes cargo checks to the generated package package", async () => {
    const calls: string[][] = [];
    const runner: CommandRunner = async (file, args) => {
      calls.push([file, ...args]);
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    await runPackageCargoChecks("/sdk", "demo", runner);

    expect(calls[1]).toEqual([
      "cargo",
      "clippy",
      "--manifest-path",
      "/sdk/packages/demo/Cargo.toml",
      "--lib",
      "--",
      "-Dwarnings",
    ]);
    expect(calls[2]).toEqual([
      "cargo",
      "test",
      "--manifest-path",
      "/sdk/packages/demo/Cargo.toml",
      "--no-run",
    ]);
  });
});
