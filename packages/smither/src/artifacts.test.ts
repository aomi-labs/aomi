import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { crateFileTree, packageCrate } from "../artifacts";

let roots: string[] = [];

function fixtureSdkRoot(app: string): string {
  const root = mkdtempSync(path.join(tmpdir(), "artifacts-test-"));
  roots.push(root);
  const appDir = path.join(root, "apps", app);
  mkdirSync(path.join(appDir, "src", "client"), { recursive: true });
  mkdirSync(path.join(appDir, "target", "release"), { recursive: true });
  writeFileSync(path.join(appDir, "Cargo.toml"), "[package]\n");
  writeFileSync(path.join(appDir, "Cargo.lock"), "# lock\n");
  writeFileSync(path.join(appDir, "src", "lib.rs"), "// lib\n");
  writeFileSync(path.join(appDir, "src", "tool.rs"), "// tool\n");
  writeFileSync(path.join(appDir, "src", "client", "client.rs"), "// client\n");
  writeFileSync(path.join(appDir, "target", "release", "junk.bin"), "junk");
  return root;
}

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

describe("crateFileTree", () => {
  it("walks the crate, folders first, skipping target and Cargo.lock", () => {
    const root = fixtureSdkRoot("my-app");
    const tree = crateFileTree(path.join(root, "apps", "my-app"), "my-app");
    expect(tree).toHaveLength(1);
    const paths = JSON.stringify(tree);
    expect(paths).toContain("my-app/src/tool.rs");
    expect(paths).toContain("my-app/src/client/client.rs");
    expect(paths).not.toContain("target");
    expect(paths).not.toContain("Cargo.lock");
    // Folders sort before files.
    expect(tree[0].children?.[0].path).toBe("my-app/src");
  });

  it("returns empty for a missing directory", () => {
    expect(crateFileTree("/nonexistent/nowhere", "x")).toEqual([]);
  });
});

describe("packageCrate", () => {
  it("embeds a decodable tarball plus the tree", async () => {
    const root = fixtureSdkRoot("my-app");
    const artifact = await packageCrate({ sdkRoot: root, app: "my-app" });
    expect(artifact.warning).toBe("");
    expect(JSON.parse(artifact.fileTreeJson)).toHaveLength(1);
    const tarPath = path.join(roots[0], "roundtrip.tar.gz");
    writeFileSync(tarPath, Buffer.from(artifact.crateTarB64, "base64"));
    const listing = execSync(`tar -tzf ${JSON.stringify(tarPath)}`).toString();
    expect(listing).toContain("my-app/src/tool.rs");
    expect(listing).not.toContain("target/");
    expect(listing).not.toContain("Cargo.lock");
  });

  it("degrades to tree-only with a warning when the crate is missing", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "artifacts-test-"));
    roots.push(root);
    const artifact = await packageCrate({ sdkRoot: root, app: "ghost" });
    expect(artifact.crateTarB64).toBe("");
    expect(artifact.warning).toContain("no generated crate");
  });
});
