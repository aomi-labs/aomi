import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/postcss";
import postcss from "postcss";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const inputPath = path.join(packageRoot, "src", "package.css");
const outputPath = path.join(packageRoot, "dist", "styles.css");
const source = await readFile(inputPath, "utf8");
const result = await postcss([tailwindcss()]).process(source, {
  from: inputPath,
  to: outputPath,
  map: false,
});

const warnings = result.warnings();
if (warnings.length > 0) {
  throw new Error(warnings.map((warning) => warning.toString()).join("\n"));
}

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, result.css);
