import { defineCommand } from "citty";

const configSetBackendDef = defineCommand({
  meta: { name: "set-backend", description: "Persist the backend base URL" },
  args: {
    url: {
      type: "positional",
      description: "Backend URL",
      required: true,
    },
  },
  async run({ args }) {
    const { setBackendCommand } = await import("../preferences");
    setBackendCommand(args.url);
  },
});

const configCurrentDef = defineCommand({
  meta: { name: "current", description: "Show the configured backend URL" },
  args: {},
  async run() {
    const { currentBackendCommand } = await import("../control");
    currentBackendCommand();
  },
});

export const configDef = defineCommand({
  meta: { name: "config", description: "CLI configuration" },
  subCommands: {
    "set-backend": configSetBackendDef,
    current: configCurrentDef,
  },
});
