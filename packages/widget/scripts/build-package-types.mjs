import { readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const types = path.join(root, "dist/types");
async function rewrite(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await rewrite(file);
    else if (entry.name.endsWith(".d.ts")) {
      const source = await readFile(file, "utf8");
      const resolved = source.replace(
        /(["'])@\/([^"']+)\1/g,
        (_match, quote, module) => {
          const relative = path
            .relative(
              path.dirname(file),
              path.join(
                types,
                module.replace(/^src\//, "").replace(/\.(ts|tsx)$/, ""),
              ),
            )
            .split(path.sep)
            .join("/");
          return `${quote}${relative.startsWith(".") ? relative : `./${relative}`}${quote}`;
        },
      );
      const nodeCompatible = resolved.replace(
        /(from\s+|import\s*(?:\(\s*)?)(["'])(\.[^"']+)\2/g,
        (_match, prefix, quote, module) => {
          if (/\.(?:js|mjs|cjs|json|css)$/.test(module))
            return `${prefix}${quote}${module}${quote}`;
          const target = path.resolve(path.dirname(file), module);
          const normalized = existsSync(`${target}.d.ts`)
            ? `${module}.js`
            : existsSync(path.join(target, "index.d.ts"))
              ? `${module}/index.js`
              : undefined;
          if (!normalized)
            throw new Error(
              `Unresolved declaration import ${module} in ${file}`,
            );
          return `${prefix}${quote}${normalized}${quote}`;
        },
      );
      await writeFile(file, nodeCompatible);
    }
  }
}
await rewrite(types);
const manifest = JSON.parse(
  await readFile(path.join(root, "package-entries.json"), "utf8"),
);
const entries = { ...manifest.entries, ...manifest.deprecated };
for (const [entry, module] of Object.entries(entries)) {
  // Rollup tree-shaking strips module directives; Next needs them on public entries.
  const javascript = path.join(root, "dist", `${entry}.js`);
  const source = await readFile(javascript, "utf8");
  if (!source.startsWith('"use client";')) {
    await writeFile(javascript, `"use client";\n${source}`);
    const mapPath = `${javascript}.map`;
    const map = JSON.parse(await readFile(mapPath, "utf8"));
    map.mappings = `;${map.mappings}`;
    await writeFile(mapPath, JSON.stringify(map));
  }
  const destination = path.join(root, "dist", `${entry}.d.ts`);
  const target = path.join(
    types,
    module.replace(/^src\//, "").replace(/\.(ts|tsx)$/, ""),
  );
  const relative = path
    .relative(path.dirname(destination), target)
    .split(path.sep)
    .join("/");
  await writeFile(
    destination,
    `export * from "${relative.startsWith(".") ? relative : `./${relative}`}.js";\n`,
  );
}

await writeFile(path.join(root, "dist/styles.d.ts"), "export {};\n");
