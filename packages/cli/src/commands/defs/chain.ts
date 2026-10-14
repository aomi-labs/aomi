import { defineCommand } from "citty";
import { buildCliConfig, globalArgs } from "./shared";

const chainListDef = defineCommand({
  meta: { name: "list", description: "List supported chains" },
  args: { ...globalArgs },
  async run({ args }) {
    const { chainsCommand } = await import("../control");
    chainsCommand(buildCliConfig(args));
  },
});

const chainSetDef = defineCommand({
  meta: { name: "set", description: "Persist the active chain ID" },
  args: {
    id: {
      type: "positional",
      description: "Chain ID",
      required: true,
    },
  },
  async run({ args }) {
    const { setChainCommand } = await import("../preferences");
    setChainCommand(args.id);
  },
});

const chainCurrentDef = defineCommand({
  meta: { name: "current", description: "Show the active chain ID" },
  args: { ...globalArgs },
  async run({ args }) {
    const { currentChainCommand } = await import("../control");
    currentChainCommand(buildCliConfig(args));
  },
});

export const chainDef = defineCommand({
  meta: { name: "chain", description: "Chain information" },
  subCommands: {
    list: chainListDef,
    set: chainSetDef,
    current: chainCurrentDef,
  },
});
