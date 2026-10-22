import { defineCommand } from "citty";
import { globalArgs, buildCliConfig } from "./shared";
import { fatal } from "../../errors";

export const chatDef = defineCommand({
  meta: { name: "chat", description: "Send a message and print the response" },
  args: {
    ...globalArgs,
    intent: { type: "string", description: "start (default), steer, or queue" },
    "turn-id": { type: "string", description: "Exact running turn to update" },
    "input-revision": {
      type: "string",
      description: "Expected input revision for steering",
    },
    "input-id": {
      type: "string",
      description: "Stable input identity, reused on retries",
    },
    verbose: {
      type: "boolean",
      alias: "v",
      description: "Stream agent responses, tool calls, and events live",
    },
    edit: { type: "string", description: "Edit a durable user message key" },
    rerun: {
      type: "string",
      description: "Rerun from a durable assistant message key",
    },
    message: {
      type: "positional",
      description: "Message to send",
      required: false,
    },
  },
  async run({ args }) {
    const { chatCommand, turnInputCommand } = await import("../chat");
    if (args.intent && args.intent !== "start") {
      if (args.intent !== "steer" && args.intent !== "queue")
        fatal("--intent must be start, steer, or queue");
      if (!args["input-id"]?.trim())
        fatal(
          "--input-id is required for steer and queue; reuse it on retries",
        );
      if (args.edit || args.rerun)
        fatal("Steering and queueing cannot be combined with edit or rerun");
      const revision = Number(args["input-revision"]);
      if (
        args.intent === "steer" &&
        (!args["turn-id"]?.trim() ||
          !Number.isSafeInteger(revision) ||
          revision < 1)
      )
        fatal("Steering requires --turn-id and a positive --input-revision");
      await turnInputCommand(buildCliConfig(args), args.message ?? "", {
        intent: args.intent,
        inputId: args["input-id"],
        targetTurnId: args["turn-id"],
        expectedInputRevision: args.intent === "steer" ? revision : undefined,
      });
      return;
    }
    await chatCommand(
      buildCliConfig(args),
      args.message ?? "",
      args.verbose === true,
      { edit: args.edit, regenerate: args.rerun },
    );
  },
});
