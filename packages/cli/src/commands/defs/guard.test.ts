import { parseArgs, type ArgsDef } from "citty";
import { describe, expect, it } from "vitest";
import { guardDef } from "./guard";

const definition = guardDef.args as ArgsDef;

describe("guard command arguments", () => {
  it.each([
    [["--account"], { account: true, level: undefined }],
    [["--thread", "session-3"], { thread: "session-3", level: undefined }],
    [["guarded_only", "--account"], { account: true, level: "guarded_only" }],
  ])("parses %j", (argv, expected) => {
    expect(parseArgs(argv, definition)).toMatchObject(expected);
  });
});
