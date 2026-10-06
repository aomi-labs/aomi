import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  newAppArgs,
  pluginLibraryFileName,
  resolveActivationCredential,
  runAomiBuild,
  runAppCargoChecks,
} from "../commands";
import type { CommandRunner, ResolvedBinaries } from "../types";

describe("commands", () => {
  it("constructs new-app args", () => {
    expect(
      newAppArgs({
        app: "demo",
        source: "url",
        openApiUrl: "https://example.com/openapi.json",
        shared: true,
        includeAllOperations: true,
        force: true,
        build: false,
      }),
    ).toEqual([
      "new-app",
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
      newAppArgs({
        app: "demo",
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
      aomiRun: "/sdk/target/release/aomi-run",
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

  it("scopes cargo checks to the generated app package", async () => {
    const calls: string[][] = [];
    const runner: CommandRunner = async (file, args) => {
      calls.push([file, ...args]);
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    await runAppCargoChecks("/sdk", "demo", runner);

    expect(calls[1]).toEqual([
      "cargo",
      "clippy",
      "--manifest-path",
      "/sdk/apps/demo/Cargo.toml",
      "--lib",
      "--",
      "-Dwarnings",
    ]);
    expect(calls[2]).toEqual([
      "cargo",
      "test",
      "--manifest-path",
      "/sdk/apps/demo/Cargo.toml",
      "--no-run",
    ]);
  });

  it("resolves deploy activation credentials with SDK precedence", async () => {
    const configRoot = await mkdtemp(path.join(os.tmpdir(), "aomi-config-"));
    const configPath = path.join(configRoot, "aomi", "config.toml");
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, 'activation_token = "saved-token"\n');

    await expect(resolveActivationCredential({ env: {}, configPath })).resolves.toEqual({
      source: "config",
      token: "saved-token",
    });
    await expect(
      resolveActivationCredential({
        env: { AOMI_APP_ACTIVATION_TOKEN: "env-token" },
        configPath,
      }),
    ).resolves.toEqual({ source: "env", token: "env-token" });
    await expect(
      resolveActivationCredential({
        activationToken: "flag-token",
        env: { AOMI_APP_ACTIVATION_TOKEN: "env-token" },
        configPath,
      }),
    ).resolves.toEqual({ source: "flag", token: "flag-token" });
    await expect(
      resolveActivationCredential({
        env: { AOMI_DEPLOY_TOKEN: "wrong-token" },
        configPath: path.join(configRoot, "missing.toml"),
      }),
    ).resolves.toBeNull();
  });

  it("matches aomi-build compile plugin names", () => {
    expect(pluginLibraryFileName("my-app", "darwin")).toBe("my_app.dylib");
    expect(pluginLibraryFileName("my-app", "linux")).toBe("my_app.so");
    expect(pluginLibraryFileName("my-app", "win32")).toBe("my_app.dll");
  });
});
