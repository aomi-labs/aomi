import { defineCommand } from "citty";
import { globalArgs, buildCliConfig, getPositionals } from "./shared";

const txListDef = defineCommand({
  meta: { name: "list", description: "List session commits and Actions" },
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
    description: "Export an exact durable commit or pending EVM Actions",
  },
  args: {
    ...globalArgs,
    format: {
      type: "string",
      description:
        "Output format: commit, eip5792 (default), moss, or metamask",
    },
    txIds: {
      type: "positional",
      description: "Commit ID (format commit) or pending EVM Action IDs",
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

const txSubmitDef = defineCommand({
  meta: {
    name: "submit",
    description:
      "Report exact externally signed bytes or an externally broadcast commit hash",
  },
  args: {
    ...globalArgs,
    "signed-file": {
      type: "string",
      description: "aomi.commit.v1 export with top-level payloads array",
    },
    "tx-hash": {
      type: "string",
      description: "Hash of an already broadcast prepared transaction",
    },
    commitId: {
      type: "positional",
      description: "Pending durable Commit ID",
      required: false,
    },
  },
  async run({ args }) {
    const { submitCommand } = await import("../submit");
    const ids = getPositionals(args);
    await submitCommand(buildCliConfig(args), ids.length === 1 ? ids[0] : "", {
      signedFile: args["signed-file"] as string | undefined,
      txHash: args["tx-hash"] as string | undefined,
    });
  },
});

const txSignDef = defineCommand({
  meta: {
    name: "sign",
    description: "Execute reviewed commits or pending Actions",
  },
  args: {
    ...globalArgs,
    eoa: {
      type: "boolean",
      description:
        "Require an ordinary EVM Action; never rewrite a prepared AA operation",
    },
    aa: {
      type: "boolean",
      description:
        "Require a backend-prepared AA owner authorization; backend submits",
    },
    txIds: {
      type: "positional",
      description: "Commit or Action IDs to execute",
      required: false,
    },
  },
  async run({ args }) {
    const { signCommand } = await import("../wallet");
    const txIds = getPositionals(args);
    await signCommand(buildCliConfig(args), txIds);
  },
});

const txRejectDef = defineCommand({
  meta: { name: "reject", description: "Reject pending commits or Actions" },
  args: {
    ...globalArgs,
    txIds: {
      type: "positional",
      description: "Commit or Action IDs to reject",
      required: false,
    },
  },
  async run({ args }) {
    const { rejectCommand } = await import("../wallet");
    await rejectCommand(buildCliConfig(args), getPositionals(args));
  },
});

export const txDef = defineCommand({
  meta: { name: "tx", description: "Transaction management" },
  subCommands: {
    list: txListDef,
    simulate: txSimulateDef,
    export: txExportDef,
    submit: txSubmitDef,
    sign: txSignDef,
    reject: txRejectDef,
  },
});
