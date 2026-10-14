#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Install one packed Next consumer; the caller owns its server and cleanupRoot. */
export async function prepareFreshNextConsumer({
  apiUrl,
  outputDirectory = mkdtempSync(join(tmpdir(), "aomi-fresh-widget-next-")),
  build = false,
}) {
  const origin = new URL(apiUrl).origin;
  const cleanupRoot = resolve(outputDirectory);
  if (
    cleanupRoot === resolve(tmpdir()) ||
    !cleanupRoot.startsWith(`${resolve(tmpdir())}/`)
  )
    throw new Error(
      "Fresh consumer output must be a child of the managed temporary directory",
    );
  const npmMajor = Number(
    execFileSync("npm", ["--version"], { encoding: "utf8" }).split(".")[0],
  );
  if (npmMajor < 11)
    throw new Error(
      "Fresh packed consumer requires tested npm11 strict peer resolution",
    );
  try {
    const run = (command, args, cwd = root) =>
      execFileSync(command, args, {
        cwd,
        timeout: command === "npm" && args[0] === "install" ? 240_000 : 300_000,
        stdio: "inherit",
        env: {
          ...process.env,
          NEXT_PUBLIC_AOMI_API_URL: origin,
          NEXT_TELEMETRY_DISABLED: "1",
        },
      });
    const widgetFolder = "packages/widget";
    const widget = JSON.parse(
      readFileSync(join(root, widgetFolder, "package.json"), "utf8"),
    );
    rmSync(cleanupRoot, { recursive: true, force: true });
    const tarballs = join(cleanupRoot, "tarballs");
    const consumerDirectory = join(cleanupRoot, "consumer");
    mkdirSync(tarballs, { recursive: true });
    mkdirSync(consumerDirectory, { recursive: true });
    const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    // prepublishOnly is absent from npm pack lifecycle; use the current widget source.
    run("corepack", ["pnpm", "--dir", widgetFolder, "build"]);
    for (const directory of ["packages/client", "packages/react", widgetFolder])
      run("corepack", [
        "pnpm",
        "--dir",
        directory,
        "pack",
        "--pack-destination",
        tarballs,
      ]);
    const dependencies = {
      next: "16.3.0",
      react: "19.3.0",
      "react-dom": "19.3.0",
      typescript: "5.9.3",
      "@types/react": "19.2.14",
      "@types/react-dom": "19.2.3",
    };
    for (const filename of readdirSync(tarballs)) {
      const path = join(tarballs, filename);
      const manifest = JSON.parse(
        execFileSync("tar", ["-xOf", path, "package/package.json"], {
          encoding: "utf8",
        }),
      );
      dependencies[manifest.name] = `file:${path}`;
    }
    const example = join(root, "examples/embed-next");
    if (existsSync(example))
      cpSync(example, consumerDirectory, {
        recursive: true,
        filter: (source) =>
          !/(?:^|\/)(node_modules|\.next|\.env[^/]*)$/.test(source),
      });
    else {
      mkdirSync(join(consumerDirectory, "app"), { recursive: true });
      writeFileSync(
        join(consumerDirectory, "app/page.tsx"),
        `"use client";import{AomiWidget}from${JSON.stringify(widget.name)};import${JSON.stringify(`${widget.name}/styles.css`)};export default function Page(){return <AomiWidget applicationId="1" baseUrl={process.env.NEXT_PUBLIC_AOMI_API_URL} height="100vh"/>}`,
      );
      writeFileSync(
        join(consumerDirectory, "app/layout.tsx"),
        'import React from"react";export default function Layout({children}:{children:React.ReactNode}){return <html><body>{children}</body></html>}',
      );
      writeFileSync(
        join(consumerDirectory, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "bundler",
            jsx: "preserve",
            esModuleInterop: true,
            strict: true,
            skipLibCheck: true,
            noEmit: true,
            lib: ["ES2022", "DOM"],
          },
          include: ["app/**/*.tsx"],
        }),
      );
    }
    writeFileSync(
      join(consumerDirectory, "package.json"),
      JSON.stringify(
        {
          name: "aomi-fresh-next-consumer",
          private: true,
          version: "0.0.0",
          type: "module",
          scripts: { build: "next build", start: "next start" },
          dependencies,
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(consumerDirectory, ".env.local"),
      `NEXT_PUBLIC_AOMI_API_URL=${origin}\n`,
    );
    run(
      "npm",
      ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
      consumerDirectory,
    );
    for (const sdk of ["@privy-io/react-auth", "@getpara/react-sdk"])
      if (existsSync(join(consumerDirectory, "node_modules", sdk)))
        throw new Error(`Default consumer unexpectedly installed ${sdk}`);
    if (build) run("npm", ["run", "build"], consumerDirectory);
    return {
      nextConsumerDirectory: consumerDirectory,
      consumerDirectory,
      framework: "next",
      apiOrigin: origin,
      packageName: widget.name,
      packageVersion: widget.version,
      sourceSha,
      cleanupRoot,
    };
  } catch (error) {
    rmSync(cleanupRoot, { recursive: true, force: true });
    throw error;
  }
}
