import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function copyTrustedConsumer(repo, commit, consumer, destinationRoot) {
  const files = execFileSync(
    "git",
    ["ls-tree", "-r", "--name-only", commit, "--", consumer],
    {
      cwd: repo,
      encoding: "utf8",
    },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  if (!files.includes(`${consumer}/package.json`))
    throw new Error(`Missing base consumer ${consumer}`);
  for (const path of files) {
    const contents = execFileSync("git", ["show", `${commit}:${path}`], {
      cwd: repo,
    });
    const output = join(destinationRoot, path);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, contents);
  }
}
