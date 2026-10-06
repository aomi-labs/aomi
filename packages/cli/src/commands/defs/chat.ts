import { defineCommand } from "citty";
import { globalArgs, buildCliConfig } from "./shared";

export const chatDef = defineCommand({
  meta: { name: "chat", description: "Send a message and print the response" },
  args: {
    ...globalArgs,
    verbose: {
      type: "boolean",
      alias: "v",
      description: "Stream agent responses, tool calls, and events live",
    },
    message: {
      type: "positional",
      description: "Message to send",
      required: false,
    },
  },
  async run({ args }) {
    const { chatCommand } = await import("../chat");
    await chatCommand(buildCliConfig(args), args.message ?? "", args.verbose === true);
  },
});
