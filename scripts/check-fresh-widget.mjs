#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  hostMarkup,
  startUpstream,
  verifyConsumer,
} from "./fixtures/widget-consumer/browser.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.argv.includes("--prepare-next")) {
  const { prepareFreshNextConsumer } =
    await import("./prepare-fresh-widget-next.mjs");
  const recordPath = process.argv[process.argv.indexOf("--prepare-next") + 1];
  const apiUrl = process.argv[process.argv.indexOf("--api-url") + 1];
  if (!recordPath || !process.argv.includes("--api-url") || !apiUrl)
    throw new Error(
      "--prepare-next <record.json> requires --api-url <BFF origin>",
    );
  const result = await prepareFreshNextConsumer({ apiUrl });
  mkdirSync(dirname(resolve(recordPath)), { recursive: true });
  writeFileSync(resolve(recordPath), JSON.stringify(result, null, 2));
  process.exit(0);
}
const output = join(root, "output/fresh-widget");
const tarballsFolder = join(output, "tarballs");
const consumer = join(output, "consumer");
const widgetFolder = "packages/widget";
const manifest = JSON.parse(
  readFileSync(join(root, widgetFolder, "package.json"), "utf8"),
);
const run = (command, args, cwd = root) =>
  execFileSync(command, args, {
    cwd,
    timeout: command === "npm" && args[0] === "install" ? 240_000 : 300_000,
    stdio: "inherit",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  });
const npmMajor = Number(
  execFileSync("npm", ["--version"], { encoding: "utf8" }).split(".")[0],
);
if (npmMajor < 11)
  throw new Error(
    "Fresh package checks need npm11+; npm9 has an optional-peer resolver conflict. Install the tested npm11.",
  );
const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
rmSync(output, { recursive: true, force: true });
mkdirSync(tarballsFolder, { recursive: true });
// npm pack does not run prepublishOnly; build the current widget source explicitly.
run("corepack", ["pnpm", "--dir", widgetFolder, "build"]);
for (const directory of ["packages/client", "packages/react", widgetFolder])
  run("corepack", [
    "pnpm",
    "--dir",
    directory,
    "pack",
    "--pack-destination",
    tarballsFolder,
  ]);
const tarballs = {};
for (const filename of readdirSync(tarballsFolder)) {
  const packed = JSON.parse(
    execFileSync(
      "tar",
      ["-xOf", join(tarballsFolder, filename), "package/package.json"],
      { encoding: "utf8" },
    ),
  );
  tarballs[packed.name] = `file:${join(tarballsFolder, filename)}`;
}
const publicConfig = (key) => {
  if (process.env[key]) return process.env[key];
  const directory = process.env.WIDGET_PUBLIC_CONFIG_DIRECTORY;
  if (!directory) return "";
  assert.ok(
    [
      "NEXT_PUBLIC_PRIVY_APP_ID",
      "NEXT_PUBLIC_PARA_API_KEY",
      "NEXT_PUBLIC_PARA_ENVIRONMENT",
    ].includes(key),
  );
  for (const name of [".env.local", ".env.auth.local"]) {
    const path = join(directory, name);
    if (!existsSync(path)) continue;
    const value = readFileSync(path, "utf8")
      .match(new RegExp(`^${key}=(.*)$`, "m"))?.[1]
      ?.trim()
      .replace(/^["']|["']$/g, "");
    if (value) return value;
  }
  return "";
};
const results = [];
const modes = process.argv.includes("--guest-only")
  ? [
      ["vite", null],
      ["next", null],
    ]
  : [
      ["vite", null],
      ["next", null],
      ["vite", "privy"],
      ["vite", "para"],
    ];
try {
  for (const [framework, provider] of modes) {
    rmSync(consumer, { recursive: true, force: true });
    mkdirSync(join(consumer, "app"), { recursive: true });
    const dependencies = {
      ...tarballs,
      react: "19.3.0",
      "react-dom": "19.3.0",
      typescript: "5.9.3",
      "@types/react": "19.2.14",
      "@types/react-dom": "19.2.3",
    };
    if (framework === "vite")
      Object.assign(dependencies, {
        vite: "8.3.2",
        "@vitejs/plugin-react": "6.1.2",
      });
    else dependencies.next = "16.3.0";
    let auth = "";
    let providerImport = "";
    if (provider) {
      const key =
        provider === "privy"
          ? "NEXT_PUBLIC_PRIVY_APP_ID"
          : "NEXT_PUBLIC_PARA_API_KEY";
      const credential = publicConfig(key);
      if (!credential)
        throw new Error(
          `Provider variant requires public ${key}; set WIDGET_PUBLIC_CONFIG_DIRECTORY or the public input directly.`,
        );
      providerImport = `import { ${provider}Auth } from '${manifest.name}';`;
      auth =
        provider === "privy"
          ? `auth={privyAuth({appId:${JSON.stringify(credential)}})}`
          : `auth={paraAuth({apiKey:${JSON.stringify(credential)},environment:${JSON.stringify(publicConfig("NEXT_PUBLIC_PARA_ENVIRONMENT") || "PROD")}})}`;
      Object.assign(
        dependencies,
        provider === "privy"
          ? {
              "@privy-io/react-auth": "2.25.0",
              "@privy-io/wagmi": "1.0.6",
              "@solana/kit": "^2.3.0",
              "@solana/spl-token": "^0.4.9",
              "@solana-program/token": "^0.5.1",
              "@solana-program/system": "^0.7.0",
              permissionless: "^0.2.47",
              "@abstract-foundation/agw-client": "^1.0.0",
            }
          : {
              "@getpara/react-sdk": "2.19.0",
              "@getpara/wagmi-v2-connector": "2.19.0",
            },
      );
    }
    writeFileSync(
      join(consumer, "package.json"),
      JSON.stringify(
        {
          name: "aomi-fresh-widget",
          version: "0.0.0",
          type: "module",
          private: true,
          dependencies,
        },
        null,
        2,
      ),
    );
    run(
      "npm",
      ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
      consumer,
    );
    const installedSdks = ["@privy-io/react-auth", "@getpara/react-sdk"].filter(
      (sdk) => existsSync(join(consumer, "node_modules", sdk)),
    );
    if (provider)
      assert.ok(
        installedSdks.includes(
          provider === "privy" ? "@privy-io/react-auth" : "@getpara/react-sdk",
        ),
        "Selected wallet SDK is installed",
      );
    if (!provider)
      for (const sdk of ["@privy-io/react-auth", "@getpara/react-sdk"])
        assert.equal(
          existsSync(join(consumer, "node_modules", sdk)),
          false,
          "Guest install excludes SDKs",
        );
    const diskKb = Number(
      execFileSync("du", ["-sk", output], { encoding: "utf8" }).split(/\s/)[0],
    );
    assert.ok(
      diskKb < 4 * 1024 * 1024,
      "Fresh consumer stays below the4GiB disk budget",
    );
    const upstream = await startUpstream();
    const component = `"use client";import React from 'react';import {AomiWidget} from '${manifest.name}';import '${manifest.name}/styles.css';${providerImport}\nexport default function Fixture(){return <><div className="host" dangerouslySetInnerHTML={{__html:${JSON.stringify(hostMarkup)}}}/><div className="widget-grid">{(['dark','light'] as const).map(theme=><AomiWidget key={theme} applicationId="1" baseUrl=${JSON.stringify(upstream.origin)} theme={theme} height="760px" ${auth}/>)}</div></>}`;
    writeFileSync(join(consumer, "fixture.tsx"), component);
    writeFileSync(
      join(consumer, "host.css"),
      readFileSync(join(root, "scripts/fixtures/widget-consumer/host.css")),
    );
    if (framework === "vite") {
      writeFileSync(
        join(consumer, "index.html"),
        '<div id="root"></div><script type="module" src="/main.tsx"></script>',
      );
      writeFileSync(
        join(consumer, "main.tsx"),
        "import React from 'react';import{createRoot}from'react-dom/client';import Fixture from './fixture';import './host.css';createRoot(document.getElementById('root')!).render(<Fixture/>);",
      );
      writeFileSync(
        join(consumer, "vite.config.mjs"),
        "import{defineConfig}from'vite';import react from '@vitejs/plugin-react';export default defineConfig({plugins:[react()]});",
      );
    } else {
      writeFileSync(
        join(consumer, "app/page.tsx"),
        '"use client";export{default}from"../fixture";',
      );
      writeFileSync(
        join(consumer, "app/layout.tsx"),
        'import React from"react";import"../host.css";export default function Layout({children}:{children:React.ReactNode}){return <html><body>{children}</body></html>}',
      );
    }
    writeFileSync(
      join(consumer, "tsconfig.json"),
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
        include: ["*.tsx", "app/**/*.tsx"],
      }),
    );
    let processHandle;
    try {
      run("npm", ["exec", "--", framework, "build"], consumer);
      run("npm", ["exec", "--", "tsc", "--noEmit"], consumer);
      if (process.env.AOMI_DOCS_DIRECTORY)
        run(process.execPath, [
          join(root, "scripts/check-widget-docs.mjs"),
          "--consumer",
          consumer,
          "--docs",
          process.env.AOMI_DOCS_DIRECTORY,
        ]);
      const port = await new Promise((resolvePort) => {
        import("node:net").then(({ createServer }) => {
          const probe = createServer();
          probe.listen(0, "127.0.0.1", () => {
            const number = probe.address().port;
            probe.close(() => resolvePort(number));
          });
        });
      });
      processHandle = spawn(
        process.execPath,
        [
          join(
            consumer,
            "node_modules",
            framework === "vite" ? "vite/bin/vite.js" : "next/dist/bin/next",
          ),
          framework === "vite" ? "preview" : "start",
          "--port",
          String(port),
        ],
        { cwd: consumer, stdio: "inherit" },
      );
      const origin = `http://localhost:${port}`;
      let ready = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        try {
          if ((await fetch(origin)).ok) {
            ready = true;
            break;
          }
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(ready, "Fresh production server starts");
      results.push({
        framework,
        sourceSha,
        packageName: manifest.name,
        packageVersion: manifest.version,
        installedSdks,
        ...(await verifyConsumer({
          origin,
          upstream,
          provider,
          css: join(root, widgetFolder, "dist/styles.css"),
        })),
        installedKiB: diskKb,
      });
      if (framework === "vite" && !provider) {
        const main = readdirSync(join(consumer, "dist/assets"))
          .filter((name) => /^index-.*\.js$/.test(name))
          .map(
            (name) =>
              gzipSync(readFileSync(join(consumer, "dist/assets", name)))
                .length,
          );
        assert.ok(
          Math.max(...main) < 1050 * 1024,
          "Fresh default widget entry stays within its1050KiB gzip budget",
        );
      }
    } finally {
      processHandle?.kill("SIGTERM");
      await upstream.close();
    }
    rmSync(join(consumer, "node_modules"), { recursive: true, force: true });
    writeFileSync(
      join(output, "results.json"),
      JSON.stringify(results, null, 2),
    );
  }
} finally {
  rmSync(join(consumer, "node_modules"), { recursive: true, force: true });
}
