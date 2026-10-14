import { parseArgs, type ArgsDef } from "citty";
import { describe, expect, it } from "vitest";
import { guardDef } from "./guard";

const definition = guardDef.args as ArgsDef;

describe("guard command arguments", () => {
  it("reads account policy without requiring a replacement mode", () => {
    expect(parseArgs(["--account"], definition)).toMatchObject({
      account: true,
      level: undefined,
    });
  });

  it("reads thread policy without requiring a replacement mode", () => {
    expect(parseArgs(["--thread", "session-3"], definition)).toMatchObject({
      thread: "session-3",
      level: undefined,
    });
  });

  it("keeps explicit policy writes available", () => {
    expect(parseArgs(["guarded_only", "--account"], definition)).toMatchObject({
      account: true,
      level: "guarded_only",
    });
  });
});
