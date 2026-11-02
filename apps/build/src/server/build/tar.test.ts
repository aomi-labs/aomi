import { execSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { extractFileFromTarGz } from "./tar";

const root = mkdtempSync(path.join(tmpdir(), "tar-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("extractFileFromTarGz", () => {
  it("round-trips a file out of a real tar.gz", () => {
    mkdirSync(path.join(root, "my-app", "src"), { recursive: true });
    writeFileSync(path.join(root, "my-app", "src", "tool.rs"), "// tools\n");
    writeFileSync(path.join(root, "my-app", "Cargo.toml"), "[package]\n");
    execSync(`tar -czf out.tar.gz my-app`, { cwd: root });
    const tarGz = readFileSync(path.join(root, "out.tar.gz"));

    expect(extractFileFromTarGz(tarGz, "my-app/src/tool.rs")?.toString()).toBe(
      "// tools\n",
    );
    expect(extractFileFromTarGz(tarGz, "my-app/Cargo.toml")?.toString()).toBe(
      "[package]\n",
    );
    expect(extractFileFromTarGz(tarGz, "my-app/nope.rs")).toBeNull();
  });

  it("rejects garbage input gracefully", () => {
    expect(extractFileFromTarGz(Buffer.from("not gzip"), "x")).toBeNull();
  });
});
