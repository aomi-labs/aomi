import { cpSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
// The original Landing Vercel project builds from the repository root.
// Nitro emits its native Build Output API artifact in the app directory.
if (process.env.VERCEL === "1") {
  const source = fileURLToPath(
    new URL("../apps/landing/.vercel/output/", import.meta.url),
  );
  const destination = fileURLToPath(
    new URL("../.vercel/output/", import.meta.url),
  );
  if (!existsSync(source + "config.json"))
    throw new Error("Missing native Landing Vercel artifact");
  rmSync(destination, { recursive: true, force: true });
  cpSync(source, destination, { recursive: true, verbatimSymlinks: true });
}
