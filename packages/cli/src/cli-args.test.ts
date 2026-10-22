import { runCommand } from "citty";
import { describe, expect, it, vi } from "vitest";
import { forwardGlobalOptions } from "./cli-args";
import { root } from "./root";

vi.mock("./commands/account", () => ({ accountLoginCommand: vi.fn() }));

describe("CLI global option forwarding", () => {
  it("sends login to the explicitly selected server through nested subcommands", async () => {
    const { accountLoginCommand } = await import("./commands/account");
    const rawArgs = await forwardGlobalOptions(root, [
      "--backend-url",
      "http://localhost:3010",
      "--chain",
      "8453",
      "account",
      "login",
      "--wallet",
    ]);
    await runCommand(root, { rawArgs });
    expect(accountLoginCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "http://localhost:3010",
        chain: 8453,
      }),
      expect.objectContaining({ wallet: true }),
    );
  });

  it("preserves the last explicit override and options between command levels", async () => {
    expect(
      await forwardGlobalOptions(root, [
        "--backend-url=https://example.invalid",
        "account",
        "--chain",
        "1",
        "login",
        "--backend-url",
        "http://localhost:3010",
        "--wallet",
      ]),
    ).toEqual([
      "account",
      "login",
      "--backend-url=https://example.invalid",
      "--chain",
      "1",
      "--backend-url",
      "http://localhost:3010",
      "--wallet",
    ]);
  });

  it("keeps flag-like string values and the positional terminator intact", async () => {
    const args = ["--prompt", "--backend-url", "--", "account", "login"];
    expect(await forwardGlobalOptions(root, args)).toEqual(args);
  });
});
