import { defineCommand } from "citty";
import { buildCliConfig, globalArgs } from "./shared";
export const byokDef = defineCommand({
  meta: { name: "byok", description: "Manage provider API keys" },
  subCommands: {
    list: defineCommand({
      meta: { name: "list", description: "List masked provider keys" },
      args: { ...globalArgs },
      async run({ args }) {
        const { showByokKeysCommand } = await import("../byok");
        await showByokKeysCommand(buildCliConfig(args));
      },
    }),
    set: defineCommand({
      meta: { name: "set", description: "Save a provider key" },
      args: {
        ...globalArgs,
        key: {
          type: "positional",
          required: true,
          description: "provider:key",
        },
      },
      async run({ args }) {
        const { saveByokKeyCommand } = await import("../byok");
        await saveByokKeyCommand(buildCliConfig(args), args.key);
      },
    }),
    clear: defineCommand({
      meta: { name: "clear", description: "Clear provider keys" },
      args: { ...globalArgs },
      async run({ args }) {
        const { clearByokKeysCommand } = await import("../byok");
        await clearByokKeysCommand(buildCliConfig(args));
      },
    }),
  },
});
