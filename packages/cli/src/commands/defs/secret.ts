import { defineCommand } from "citty";
import { fatal } from "../../errors";
import { globalArgs, buildCliConfig, getPositionals } from "./shared";

const secretListDef = defineCommand({
  meta: { name: "list", description: "List configured secrets for the active session" },
  args: {},
  async run() {
    const { listSecretsCommand } = await import("../secrets");
    listSecretsCommand();
  },
});

const secretClearDef = defineCommand({
  meta: { name: "clear", description: "Clear all secrets for the active session" },
  args: { ...globalArgs },
  async run({ args }) {
    const { clearSecretsCommand } = await import("../secrets");
    await clearSecretsCommand(buildCliConfig(args));
  },
});

const secretAddDef = defineCommand({
  meta: { name: "add", description: "Add one or more secrets (NAME=value)" },
  args: {
    ...globalArgs,
    secret: {
      type: "positional",
      description: "Secret in NAME=value format",
      required: false,
    },
  },
  async run({ args }) {
    const { ingestSecretsCommand } = await import("../secrets");
    const config = buildCliConfig(args);
    const secretArgs = getPositionals(args);
    if (secretArgs.length === 0) {
      fatal("Usage: aomi secret add NAME=value [NAME=value ...]");
    }

    for (const secret of secretArgs) {
      const eqIdx = secret.indexOf("=");
      if (eqIdx <= 0) {
        fatal(
          `Invalid secret "${secret}". Use NAME=value format.\nUsage: aomi secret add NAME=value [NAME=value ...]`,
        );
      }
      config.secrets[secret.slice(0, eqIdx)] = secret.slice(eqIdx + 1);
    }

    await ingestSecretsCommand(config);
  },
});

export const secretDef = defineCommand({
  meta: { name: "secret", description: "Secret management" },
  subCommands: {
    list: secretListDef,
    clear: secretClearDef,
    add: secretAddDef,
  },
});
