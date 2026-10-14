import { readFile, writeFile, mkdir, rm, cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
);
await rm(resolve(root, "dist"), { recursive: true, force: true });
for (const [entry, target] of Object.entries(manifest.exports)) {
  if (typeof target === "string") continue;
  if (entry.endsWith(".css")) {
    await mkdir(dirname(resolve(root, target.types)), { recursive: true });
    await writeFile(resolve(root, target.types), "export {};\n");
    continue;
  }
  const source =
    entry === "." ? "@aomi-labs/widget" : `@aomi-labs/widget/${entry.slice(2)}`;
  for (const [kind, path] of Object.entries(target)) {
    const destination = resolve(root, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(
      destination,
      `${kind === "import" ? '"use client";\n' : ""}export * from "${source}";\n`,
    );
  }
}
await cp(
  fileURLToPath(import.meta.resolve("@aomi-labs/widget/styles.css")),
  resolve(root, "dist/styles.css"),
);
const canonical = dirname(
  fileURLToPath(import.meta.resolve("@aomi-labs/widget")),
);
const themes = resolve(canonical, "../src/themes");
await cp(themes, resolve(root, "themes"), { recursive: true });
