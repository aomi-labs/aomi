import { build } from "esbuild";
import { stripTypeScriptTypes } from "node:module";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const check = process.argv.includes("--check");
// esbuild's source labels depend on package-manager symlink layout. Normalize
// only generated source comments and module-factory labels, never runtime data.
const location = (value) => {
  const dependency = value.lastIndexOf("node_modules/");
  if (dependency >= 0) return value.slice(dependency);
  const source = value.lastIndexOf("src/");
  if (source >= 0) return value.slice(source);
  if (value.startsWith("vendor/") || value === "payment-runtime.browser.ts") return "src/" + value;
  return value;
};
export const normalizeBundleLabels = (code) => code
  .replace(/^\/\/ (.+\.(?:[cm]?js|tsx?|json))$/gm, (_, value) => "// " + location(value))
  .replace(/^(  ")([^"\n]+\.(?:[cm]?js|tsx?|json))("\([^\n]*\) \{)$/gm,
    (_, start, value, end) => start + location(value) + end);
const outputs = new Map();
const clientSource = await readFile(resolve(here, "src/browser-task-client.ts"), "utf8");
const originalLines = clientSource.split("\n");
// Type stripping pads removed annotations with spaces. Remove only that new
// suffix padding, preserving whitespace already present in the source (which
// could belong to a multiline string).
const client = stripTypeScriptTypes(clientSource, { mode: "strip" })
  .split("\n").map((line, index) => {
    const trimmed = line.replace(/[ \t]+$/u, "");
    if (trimmed === line) return line;
    const original = originalLines[index];
    if (original === undefined) throw new Error("Type stripping changed line alignment");
    return /[^ \t]/u.test(original.slice(trimmed.length))
      ? trimmed + original.match(/[ \t]*$/u)[0] : line;
  }).join("\n");
outputs.set("src/browser-task-client.mjs", client);
for (const [entry, output] of [
  ["src/trusted-host-entry.ts", "dist/shadow-trial.bundle.mjs"],
  ["src/payment-runtime.browser.ts", "src/sdk-browser-build/actual-payment-runtime.bundle.mjs"],
]) {
  const result = await build({ absWorkingDir: here, entryPoints: [entry], bundle: true,
    platform: "browser", format: "esm", target: "es2022", write: false,
    metafile: true, legalComments: "eof", logLevel: "silent",
    plugins: [{ name: "current-browser-client", setup(build) {
      build.onLoad({ filter: /browser-task-client\.mjs$/ }, () => ({ contents: client, loader: "js" }));
    } }],
  });
  if (Object.values(result.metafile.outputs).some((output) => output.imports.length)) {
    throw new Error("Shadow runtime must have no external browser imports");
  }
  outputs.set(output, normalizeBundleLabels(result.outputFiles[0].text));
}
outputs.set("dist/shadow-trial.bundle.d.mts", await readFile(resolve(here, "src/trusted-host-entry.d.mts"), "utf8"));
const portal = resolve(here, "../../apps/portal/src/features/shadow-trial");
try { await access(portal); } catch { throw new Error("Run this tooling from tools/shadow-trial in the Aomi checkout"); }
for (const [relative, contents] of outputs) {
  const target = resolve(here, relative);
  if (check) {
    const existing = await readFile(target, "utf8");
    if ((relative.endsWith("bundle.mjs") ? normalizeBundleLabels(existing) : existing) !== contents) {
      throw new Error("Generated source/artifact mismatch: " + relative);
    }
  } else { await mkdir(dirname(target), { recursive: true }); await writeFile(target, contents); }
}
for (const name of ["shadow-trial.bundle.mjs", "shadow-trial.bundle.d.mts"]) {
  const contents = outputs.get("dist/" + name);
  if (check) {
    const existing = await readFile(resolve(portal, name), "utf8");
    if ((name.endsWith(".mjs") ? normalizeBundleLabels(existing) : existing) !== contents) throw new Error("Portal artifact is stale: " + name);
  } else await writeFile(resolve(portal, name), contents);
}
console.log(check ? "Shadow generated artifacts match source and Portal." : "Shadow source, SDK fixture and Portal artifacts regenerated.");
