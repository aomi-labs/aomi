// @vitest-environment node
import { spawn, spawnSync } from "node:child_process";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { beforeEach, expect, it, vi } from "vitest";

const dir = vi.hoisted(() => {
  const path = `${process.env.TMPDIR ?? "/tmp"}/aomi-state-test-${process.pid}`;
  process.env.AOMI_STATE_DIR = path;
  return path;
});

import { loadState, updateState } from "./state";

const file = `${dir}/cli.json`;
/** A lock `pid` took a minute ago. */
const lockOf = (pid: number) => {
  writeFileSync(`${file}.lock`, `${pid}@${hostname()}@1d`);
  const old = new Date(Date.now() - 60_000);
  utimesSync(`${file}.lock`, old, old);
};

beforeEach(() => {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir);
});

it("makes a readable file private, and leaves no lock or temp file", () => {
  writeFileSync(file, "{}", { mode: 0o644 });
  updateState({ evmKey: "0x1" });
  expect(statSync(file).mode & 0o777).toBe(0o600);
  expect(readdirSync(dir)).toEqual(["cli.json"]);
});

it("merges into the file as it is now", () => {
  updateState({ evmKey: "0x1", thread: "t" });
  // Another process wrote meanwhile.
  writeFileSync(file, JSON.stringify({ ...loadState(), model: "m" }));
  updateState((state) => ({ rpc: { ...state.rpc, a: { b: "c" } } }));
  expect(updateState({ thread: undefined })).toMatchObject({
    evmKey: "0x1",
    model: "m",
    rpc: { a: { b: "c" } },
  });
  expect(loadState()).not.toHaveProperty("thread");
});

it.each(["{ half", "null", "[]", ""])(
  "never replaces or prints a file that is not valid: %j",
  (text) => {
    writeFileSync(file, text);
    expect(() => updateState({ model: "m" })).toThrow(`${file} is not valid`);
    expect(() => loadState()).toThrow("is not valid");
    expect(readFileSync(file, "utf8")).toBe(text);
    expect(readdirSync(dir)).toEqual(["cli.json"]);
  },
);

it("takes over a lock whose process is gone, with the copy it left", () => {
  lockOf(spawnSync(process.execPath, ["-e", ""]).pid);
  writeFileSync(`${file}.1d`, '{"evmKey":"0x1"}');
  updateState({ model: "m" });
  expect(loadState()).toEqual({ model: "m" });
  expect(readdirSync(dir)).toEqual(["cli.json"]);
});

it("waits for a paused writer and keeps the key it saves", () => {
  const { pid } = spawn(process.execPath, [
    "-e",
    `setTimeout(() => {
      fs.writeFileSync(${JSON.stringify(file)}, '{"evmKey":"0x1"}');
      fs.rmSync(${JSON.stringify(`${file}.lock`)});
    }, 300)`,
  ]);
  lockOf(pid!);
  updateState({ model: "m" });
  expect(loadState()).toEqual({ evmKey: "0x1", model: "m" });
});

it("writes nothing, and takes no lock, while its process lives on", () => {
  lockOf(process.ppid);
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => (now += 6000));
  expect(() => updateState({ model: "m" })).toThrow(
    `Another aomi is writing ${file}`,
  );
  expect(readdirSync(dir)).toEqual(["cli.json.lock"]);
});
