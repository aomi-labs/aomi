import { defineCommand } from "citty";
import { globalArgs } from "./shared";

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
  meta: {
    name: "current",
    description: "Show the effective connection origin and its source",
  },
  args: { ...globalArgs },
  async run({ args }) {
    const { currentBackendCommand } = await import("../control");
    // Connection inspection needs no signing key or account credential.
    currentBackendCommand({
      baseUrl:
        typeof args["backend-url"] === "string"
          ? args["backend-url"]
          : undefined,
      json: args.json === true,
      verbose: args.verbose === true,
    });
  },
});

export const configDef = defineCommand({
  meta: { name: "config", description: "CLI configuration" },
  subCommands: {
    "set-backend": configSetBackendDef,
    current: configCurrentDef,
  },
});
