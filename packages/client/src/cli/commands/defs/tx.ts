import { defineCommand } from "citty";
import { globalArgs, buildCliConfig, getPositionals } from "./shared";

const txListDef = defineCommand({
  meta: { name: "list", description: "List session Actions" },
  args: { ...globalArgs },
  async run({ args }) {
    const { txCommand } = await import("../wallet");
    await txCommand(buildCliConfig(args));
  },
});

const txSimulateDef = defineCommand({
  meta: {
    name: "simulate",
    description: "Simulate EVM execution Actions",
  },
  args: {
    ...globalArgs,
    txIds: {
      type: "positional",
      description: "Action IDs to simulate",
      required: false,
    },
  },
  async run({ args }) {
    const { simulateCommand } = await import("../simulate");
    const txIds = getPositionals(args);
    await simulateCommand(buildCliConfig(args), txIds);
  },
});

const txExportDef = defineCommand({
  meta: {
    name: "export",
    description: "Export pending EVM Actions for an external wallet",
  },
  args: {
    ...globalArgs,
    format: {
      type: "string",
      description: "Output format: eip5792 (default), moss, or metamask",
    },
    txIds: {
      type: "positional",
      description: "Pending EVM Action IDs to export",
      required: false,
    },
  },
  async run({ args }) {
    const { exportCommand } = await import("../export");
    await exportCommand(
      buildCliConfig(args),
      getPositionals(args),
      typeof args.format === "string" ? args.format : undefined,
    );
  },
});

const txSignDef = defineCommand({
  meta: { name: "sign", description: "Execute pending Actions" },
  args: {
    ...globalArgs,
    eoa: {
      type: "boolean",
      description:
        "Plain EOA execution (the default; local signing is always EOA)",
    },
    aa: {
      type: "boolean",
      description:
        "Request AA execution — errors: AA now runs in the backend lane",
    },
    "aa-provider": {
      type: "string",
      description:
        "AA provider preference synced to user_state: alchemy | pimlico",
    },
    "aa-mode": {
      type: "string",
      description: "AA mode preference synced to user_state: 4337 | 7702",
    },
    txIds: {
      type: "positional",
      description: "Action IDs to execute",
      required: false,
    },
  },
  async run({ args }) {
    const { signCommand } = await import("../wallet");
    const txIds = getPositionals(args);
    await signCommand(buildCliConfig(args), txIds);
  },
});

export const txDef = defineCommand({
  meta: { name: "tx", description: "Transaction management" },
  subCommands: {
    list: txListDef,
    simulate: txSimulateDef,
    export: txExportDef,
    sign: txSignDef,
  },
});
