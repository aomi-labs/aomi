import { defineCommand } from "citty";
import { globalArgs, buildCliConfig, getPositionals } from "./shared";

const txPreflightDef = defineCommand({
  meta: {
    name: "preflight",
    description:
      "Check which catalogued wallets can fund an ERC-20 transfer; never signs",
  },
  args: {
    file: {
      type: "positional",
      required: true,
      description: "Intent JSON: amount, recipient and wallets with RPC URLs",
    },
  },
  async run({ args }) {
    const { preflightCommand } = await import("../preflight");
    await preflightCommand(args.file);
  },
});

const txListDef = defineCommand({
  meta: { name: "list", description: "List session commits and Actions" },
  args: { ...globalArgs },
  async run({ args }) {
    const { txCommand } = await import("../wallet");
    await txCommand(buildCliConfig(args));
  },
});

const txShowDef = defineCommand({
  meta: {
    name: "show",
    description:
      "Show one commit by ref: state, chain, signer, origin and sign URL",
  },
  args: {
    ...globalArgs,
    ref: {
      type: "positional",
      description: "Commit ref",
      required: false,
    },
  },
  async run({ args }) {
    const { txShowCommand } = await import("../tx-show");
    const refs = getPositionals(args);
    await txShowCommand(buildCliConfig(args), refs.length === 1 ? refs[0] : "");
  },
});

const txApproveDef = defineCommand({
  meta: {
    name: "approve",
    description:
      "Approve a commit waiting for your approval; Aomi signs with the agent wallet",
  },
  args: {
    ...globalArgs,
    ref: {
      type: "positional",
      description: "Commit ref",
      required: false,
    },
    yes: {
      type: "boolean",
      description: "Approve without asking (required outside a terminal)",
    },
    wait: {
      type: "boolean",
      default: true,
      description: "Follow the commit until it settles (--no-wait skips)",
    },
  },
  async run({ args }) {
    const { txApproveCommand } = await import("../tx-approve");
    const refs = getPositionals(args);
    await txApproveCommand(
      buildCliConfig(args),
      refs.length === 1 ? refs[0] : "",
      { yes: args.yes === true, noWait: args.wait === false },
    );
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
    preflight: txPreflightDef,
    list: txListDef,
    show: txShowDef,
    approve: txApproveDef,
    simulate: txSimulateDef,
    export: txExportDef,
    submit: txSubmitDef,
    sign: txSignDef,
    reject: txRejectDef,
  },
});
