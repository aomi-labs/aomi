// @vitest-environment node
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";

const dir = vi.hoisted(() => {
  const path = `${process.env.TMPDIR ?? "/tmp"}/aomi-state-test-${process.pid}`;
  process.env.AOMI_STATE_DIR = path;
  return path;
});

import { loadState, updateState } from "./state";

const file = `${dir}/cli.json`;

beforeEach(() => {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir);
});

it("makes a readable file private, and leaves no lock or temp file", () => {
  writeFileSync(file, "{}", { mode: 0o644 });
  updateState({ evmKey: "0x1" });
  expect(statSync(file).mode & 0o777).toBe(0o600);
  expect(existsSync(`${file}.lock`)).toBe(false);
  expect(existsSync(`${file}.new`)).toBe(false);
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
    expect(existsSync(`${file}.lock`)).toBe(false);
  },
);

it("takes over a lock whose process is gone", () => {
  writeFileSync(`${file}.lock`, "");
  const old = new Date(Date.now() - 60_000);
  utimesSync(`${file}.lock`, old, old);
  updateState({ model: "m" });
  expect(loadState()).toEqual({ model: "m" });
});
