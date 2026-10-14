import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { importerVersions } from "./consumer-lockfile.mjs";

export function trustedConsumers(repo, commit, onlyWidget = false) {
  const consumers = [
    { kind: "headless", path: "apps/examples/headless-client" },
    { kind: "headless", path: "examples/headless" },
    { kind: "widget", path: "apps/widget-consumer" },
    { kind: "widget", path: "examples/embed-vite" },
  ].filter(({ kind }) => !onlyWidget || kind === "widget");
  const files = execFileSync(
    "git",
    [
      "ls-tree",
      "-r",
      "--name-only",
      commit,
      "--",
      ...consumers.map(({ path }) => path),
    ],
    { cwd: repo, encoding: "utf8" },
  ).split("\n");
  return consumers.filter(({ path }) => files.includes(`${path}/package.json`));
}

export function trustedConsumerImporters(lockfile, consumers) {
  const widgets = Object.fromEntries(
    consumers
      .filter(({ kind }) => kind === "widget")
      .map(({ path }) => [path, importerVersions(lockfile, path)]),
  );
  return {
    widgets,
    registry: widgets["apps/widget-consumer"]
      ? importerVersions(lockfile, "apps/shadcn-registry")
      : {},
  };
}

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
