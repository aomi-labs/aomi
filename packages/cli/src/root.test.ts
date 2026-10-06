import { describe, expect, it } from "vitest";

import { hasRootSubcommand, root, SUBCOMMAND_NAMES } from "../../src/cli/root";

describe("CLI root subcommand registration", () => {
  // Regression: `deploy` was listed in the hand-written root help and in
  // main.ts's routing set, but was never added to `root.subCommands`. The
  // command was therefore unreachable — `aomi deploy` failed with "Unknown
  // command deploy" while `aomi --help` advertised it. Keep the name set and
  // the registered subcommands in lockstep so help can never promise a
  // command the dispatcher cannot run.
  it("registers every name in SUBCOMMAND_NAMES as a real subcommand", () => {
    const registered = Object.keys(root.subCommands ?? {});
    expect([...SUBCOMMAND_NAMES].sort()).toEqual(registered.sort());
  });

  it("exposes deploy as a runnable subcommand", () => {
    expect(Object.keys(root.subCommands ?? {})).toContain("deploy");
    expect(hasRootSubcommand(["deploy", "--project-id", "1"])).toBe(true);
  });

  it("exposes Pipeline discovery and safe execution as a runnable subcommand", () => {
    expect(Object.keys(root.subCommands ?? {})).toContain("pipeline");
    expect(
      hasRootSubcommand(["pipeline", "build", "balance", "--app", "wallet"]),
    ).toBe(true);
  });
});

describe("CLI root dispatch", () => {
  it("recognizes a subcommand after global options and their values", () => {
    expect(
      hasRootSubcommand([
        "--backend-url",
        "http://127.0.0.1:8080",
        "--account-bearer",
        "token",
        "tx",
        "sign",
        "tx-50",
      ]),
    ).toBe(true);
  });

  it("keeps root prompt mode when no subcommand is present", () => {
    expect(
      hasRootSubcommand([
        "--backend-url",
        "http://127.0.0.1:8080",
        "--prompt",
        "show my SOL balance",
      ]),
    ).toBe(false);
  });
});
