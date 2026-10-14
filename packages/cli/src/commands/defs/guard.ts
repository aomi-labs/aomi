import { defineCommand } from "citty";
import { buildCliConfig, globalArgs } from "./shared";
export const guardDef = defineCommand({
  meta: {
    name: "guard",
    description:
      "Read or update transaction guard policy using its authoritative revision",
  },
  args: {
    ...globalArgs,
    level: {
      type: "positional",
      required: false,
      description: "Optional guarded_only, balanced, or unrestricted",
    },
    account: { type: "boolean", description: "Use the account default policy" },
    thread: {
      type: "string",
      description:
        "Remote thread ID or local session-N (default: active thread)",
    },
  },
  async run({ args }) {
    const { guardCommand } = await import("../guard");
    await guardCommand(buildCliConfig(args), {
      mode: args.level,
      account: args.account,
      thread: args.thread,
    });
  },
});
