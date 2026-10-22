import { parseArgs, type ArgsDef } from "citty";
import { describe, expect, it } from "vitest";
import { guardDef } from "./guard";

const definition = guardDef.args as ArgsDef;

describe("guard command arguments", () => {
  it.each([
    [
      "reads account policy without requiring a replacement mode",
      ["--account"],
      { account: true, level: undefined },
    ],
    [
      "reads thread policy without requiring a replacement mode",
      ["--thread", "session-3"],
      { thread: "session-3", level: undefined },
    ],
    [
      "keeps explicit policy writes available",
      ["guarded_only", "--account"],
      { account: true, level: "guarded_only" },
    ],
  ])("%s", (_name, argv, expected) => {
    expect(parseArgs(argv, definition)).toMatchObject(expected);
  });
});
