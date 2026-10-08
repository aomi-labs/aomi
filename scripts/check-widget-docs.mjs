#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { basename, join, resolve } from "node:path";
const option = (name) => process.argv[process.argv.indexOf(name) + 1];
if (!process.argv.includes("--consumer") || !process.argv.includes("--docs")) {
  throw new Error(
    "Pass --consumer <fresh packed install> --docs <aomi-labs/docs checkout>",
  );
}
const consumer = resolve(option("--consumer"));
const docs = resolve(option("--docs"));
if (!existsSync(join(docs, "docs.json")))
  throw new Error("Expected the canonical Mintlify docs checkout");
const generated = join(consumer, ".aomi-doc-snippets");
rmSync(generated, { recursive: true, force: true });
mkdirSync(generated, { recursive: true });
let count = 0;
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith(".")) walk(path);
      continue;
    }
    if (!entry.name.endsWith(".mdx")) continue;
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(/```(tsx?|jsx?)\s*\n([\s\S]*?)```/g)) {
      if (!match[2].includes("@aomi-labs/widget")) continue;
      // Preserve the canonical snippet; the fresh consumer supplies its dependencies.
      writeFileSync(
        join(generated, `${++count}-${basename(path, ".mdx")}.tsx`),
        match[2],
      );
    }
  }
}
walk(docs);
if (!count) throw new Error("No canonical widget examples found");
const consumerRequire = createRequire(join(consumer, "package.json"));
const typescript = consumerRequire("typescript");
const playground = join(docs, "snippets/widget-playground.jsx");
const compiled = typescript.transpileModule(readFileSync(playground, "utf8"), {
  compilerOptions: {
    module: typescript.ModuleKind.CommonJS,
    jsx: typescript.JsxEmit.ReactJSX,
    target: typescript.ScriptTarget.ES2022,
  },
});
const playgroundExports = {};
runInNewContext(
  compiled.outputText,
  {
    exports: playgroundExports,
    require: (name) => {
      assert.equal(
        name,
        "react/jsx-runtime",
        "Playground uses only Mintlify's provided React environment",
      );
      return consumerRequire(name);
    },
  },
  { timeout: 1000 },
);
assert.equal(typeof playgroundExports.generateWidgetPlaygroundCode, "function");
let playgroundCount = 0;
for (const showSidebar of [false, true])
  for (const showHeader of [false, true])
    for (const walletPosition of ["header", "footer", "hidden"])
      for (const mode of ["dark", "light"])
        for (let mask = 0; mask < 16; mask++) {
          const controls = Object.fromEntries(
            ["Model", "API Key", "Wallet", "Network"].map((name, index) => [
              name,
              Boolean(mask & (1 << index)),
            ]),
          );
          const result = playgroundExports.generateWidgetPlaygroundCode({
            showSidebar,
            showHeader,
            walletPosition,
            mode,
            controls,
            theme: {
              background: "#123456",
              foreground: "#ffffff",
              muted: "#abcdef",
              sidebar: "#234567",
              panel: "#345678",
              primary: "#456789",
              radius: 12,
            },
          });
          assert.ok(result.jsx.includes('applicationId="123"'));
          assert.ok(
            result.jsx.includes(
              'import { AomiWidget } from "@aomi-labs/widget"',
            ),
          );
          assert.ok(result.jsx.includes(`showSidebar={${showSidebar}}`));
          assert.ok(result.jsx.includes(`showHeader={${showHeader}}`));
          assert.ok(
            result.jsx.includes(
              walletPosition === "hidden"
                ? "walletPosition={null}"
                : `walletPosition="${walletPosition}"`,
            ),
          );
          assert.ok(
            !/:root|\b(?:body|html)\s*\{/.test(result.css),
            "Copied themes cannot restyle the host",
          );
          assert.ok(result.css.includes(".assistant-theme .aomi-widget.light"));
          assert.ok(result.css.includes(".assistant-theme .aomi-widget.dark"));
          writeFileSync(
            join(generated, `playground-${++playgroundCount}.tsx`),
            result.jsx,
          );
        }
writeFileSync(
  join(generated, "tsconfig.json"),
  JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        jsx: "react-jsx",
        strict: true,
        skipLibCheck: true,
        esModuleInterop: true,
        noEmit: true,
        lib: ["ES2022", "DOM"],
        types: ["react", "react-dom"],
      },
      include: ["*.tsx"],
    },
    null,
    2,
  ),
);
execFileSync(
  process.execPath,
  [
    join(consumer, "node_modules/typescript/bin/tsc"),
    "--project",
    join(generated, "tsconfig.json"),
  ],
  { cwd: consumer, stdio: "inherit" },
);
console.log(
  `Compiled ${count} canonical widget snippets and ${playgroundCount} generated playground variants against packed packages.`,
);
