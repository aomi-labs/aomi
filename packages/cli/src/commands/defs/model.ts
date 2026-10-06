import { defineCommand } from "citty";
import { globalArgs, buildCliConfig } from "./shared";

const modelListDef = defineCommand({
  meta: { name: "list", description: "List models available to the current backend" },
  args: { ...globalArgs },
  async run({ args }) {
    const { modelsCommand } = await import("../control");
    await modelsCommand(buildCliConfig(args));
  },
});

const modelSetDef = defineCommand({
  meta: { name: "set", description: "Set the active model for the current session" },
  args: {
    ...globalArgs,
    rig: {
      type: "positional",
      description: "Model rig name",
      required: true,
    },
  },
  async run({ args }) {
    const { setModelCommand } = await import("../control");
    await setModelCommand(buildCliConfig(args), args.rig);
  },
});

const modelCurrentDef = defineCommand({
  meta: { name: "current", description: "Show current model" },
  args: {},
  async run() {
    const { currentModelCommand } = await import("../control");
    currentModelCommand();
  },
});

export const modelDef = defineCommand({
  meta: { name: "model", description: "Model management" },
  subCommands: {
    list: modelListDef,
    set: modelSetDef,
    current: modelCurrentDef,
  },
});
