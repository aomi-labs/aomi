import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AomiOAuthGrant, AomiOAuthGrantStore } from "./authorization";

/**
 * Keep OAuth grants in a private JSON file, so a sign-in outlives the
 * process. Defaults to `~/.config/aomi/grants.json` (`$XDG_CONFIG_HOME`
 * when set).
 */
export function fileGrants(
  path = join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
    "aomi",
    "grants.json",
  ),
): AomiOAuthGrantStore {
  return {
    async load() {
      try {
        return JSON.parse(await readFile(path, "utf8")) as AomiOAuthGrant[];
      } catch (error) {
        if ((error as { code?: string }).code === "ENOENT") return [];
        throw error;
      }
    },
    async save(grants) {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const next = `${path}.${process.pid}.tmp`;
      await writeFile(next, JSON.stringify(grants, null, 2), { mode: 0o600 });
      await rename(next, path);
    },
  };
}
