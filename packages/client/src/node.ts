import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AomiOAuthGrant, AomiOAuthGrantStore } from "./authorization";

/**
 * Keep OAuth grants in a private JSON file, so a sign-in outlives the
 * process. Defaults to `~/.config/aomi/grants.json` (`$XDG_CONFIG_HOME`
 * when set). A file that is not a grant list reads as empty, and is kept
 * next to it as `.bak`.
 */
export function fileGrants(
  path = join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
    "aomi",
    "grants.json",
  ),
): AomiOAuthGrantStore {
  let saving = Promise.resolve();
  return {
    async load() {
      let text: string;
      try {
        text = await readFile(path, "utf8");
      } catch (error) {
        if ((error as { code?: string }).code === "ENOENT") return [];
        throw error;
      }
      try {
        const grants: unknown = JSON.parse(text);
        if (Array.isArray(grants)) return grants as AomiOAuthGrant[];
      } catch {
        // Unreadable: kept as .bak below.
      }
      await copyFile(path, `${path}.bak`);
      return [];
    },
    save(grants) {
      const write = async () => {
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        const next = `${path}.${process.pid}.${randomUUID()}.tmp`;
        await writeFile(next, JSON.stringify(grants, null, 2), {
          mode: 0o600,
        });
        await rename(next, path);
      };
      return (saving = saving.then(write, write));
    },
  };
}
