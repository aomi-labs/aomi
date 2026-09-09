import { defineCommand } from "citty";
import { buildCliConfig, getPositionals, globalArgs } from "./shared";

const pipelineArgs = {
  "backend-url": globalArgs["backend-url"],
  "api-key": globalArgs["api-key"],
  "account-bearer": globalArgs["account-bearer"],
  app: globalArgs.app,
  "private-key": globalArgs["private-key"],
  "rpc-url": globalArgs["rpc-url"],
  "payment-method": globalArgs["payment-method"],
} as const;

const filterArgs = {
  filter: {
    type: "string",
    alias: "q",
    description: "Keep entries whose name contains this text",
  },
  limit: { type: "string", description: "Maximum entries to print" },
} as const;

const scopeArgs = {
  ...pipelineArgs,
  skill: { type: "string", description: "Use a skill operation scope" },
} as const;

const operationArg = {
  operation: {
    type: "positional",
    description: "Operation name",
    required: true,
  },
} as const;

const argumentsArg = {
  arguments: {
    type: "string",
    description: "JSON object, file path, @file, or - for stdin (default: {})",
  },
} as const;

const idempotencyArg = {
  "idempotency-key": {
    type: "string",
    description: "Stable key to reuse when manually retrying the same mutation",
  },
} as const;

const pipelineReadDef = defineCommand({
  meta: { name: "read", description: "Read any Pipeline filesystem resource" },
  args: {
    ...pipelineArgs,
    path: {
      type: "positional",
      description: "Path beneath /v1/pipeline (default: root)",
      required: false,
    },
  },
  async run({ args }) {
    const { pipelineReadCommand } = await import("../pipeline");
    await pipelineReadCommand(
      buildCliConfig(args),
      text(getPositionals(args)[0]),
    );
  },
});

const pipelineAppsDef = defineCommand({
  meta: { name: "apps", description: "List Pipeline apps" },
  args: { ...pipelineArgs, ...filterArgs },
  async run({ args }) {
    const { pipelineAppsCommand } = await import("../pipeline");
    await pipelineAppsCommand(buildCliConfig(args), listOptions(args));
  },
});

const pipelineAppDef = defineCommand({
  meta: { name: "app", description: "Describe one Pipeline app" },
  args: {
    ...pipelineArgs,
    appName: {
      type: "positional",
      description: "App name",
      required: true,
    },
  },
  async run({ args }) {
    const { pipelineAppCommand } = await import("../pipeline");
    await pipelineAppCommand(buildCliConfig(args), getPositionals(args)[0]!);
  },
});

const pipelineSkillsDef = defineCommand({
  meta: { name: "skills", description: "List Pipeline skills" },
  args: { ...pipelineArgs, ...filterArgs },
  async run({ args }) {
    const { pipelineSkillsCommand } = await import("../pipeline");
    await pipelineSkillsCommand(buildCliConfig(args), listOptions(args));
  },
});

const pipelineSkillDef = defineCommand({
  meta: { name: "skill", description: "Describe one Pipeline skill" },
  args: {
    ...pipelineArgs,
    skillName: {
      type: "positional",
      description: "Skill name",
      required: true,
    },
    instructions: {
      type: "boolean",
      description: "Print the skill's SKILL.md instead of its directory",
    },
  },
  async run({ args }) {
    const { pipelineSkillCommand } = await import("../pipeline");
    await pipelineSkillCommand(
      buildCliConfig(args),
      getPositionals(args)[0]!,
      args.instructions === true,
    );
  },
});

const pipelineOperationsDef = defineCommand({
  meta: {
    name: "operations",
    description: "List operations for an app or skill",
  },
  args: { ...scopeArgs, ...filterArgs },
  async run({ args }) {
    const { pipelineOperationsCommand } = await import("../pipeline");
    await pipelineOperationsCommand(buildCliConfig(args), {
      ...scopeOptions(args),
      ...listOptions(args),
    });
  },
});

const pipelineOperationDef = defineCommand({
  meta: {
    name: "operation",
    description: "Describe one app or skill operation",
  },
  args: { ...scopeArgs, ...operationArg },
  async run({ args }) {
    const { pipelineOperationCommand } = await import("../pipeline");
    await pipelineOperationCommand(
      buildCliConfig(args),
      getPositionals(args)[0]!,
      scopeOptions(args),
    );
  },
});

const pipelineInvokeDef = defineCommand({
  meta: {
    name: "invoke",
    description: "Validate and invoke one app or skill operation",
  },
  args: {
    ...scopeArgs,
    ...operationArg,
    ...argumentsArg,
    ...idempotencyArg,
  },
  async run({ args }) {
    const { pipelineInvokeCommand } = await import("../pipeline");
    await pipelineInvokeCommand(
      buildCliConfig(args),
      getPositionals(args)[0]!,
      {
        ...scopeOptions(args),
        arguments: text(args.arguments),
        idempotencyKey: text(args["idempotency-key"]),
      },
    );
  },
});

const pipelineBuildDef = defineCommand({
  meta: {
    name: "build",
    description: "Build and simulate one app or skill operation",
  },
  args: {
    ...scopeArgs,
    ...operationArg,
    ...argumentsArg,
    "chain-family": {
      type: "string",
      description: "Override descriptor inference with evm or svm",
    },
  },
  async run({ args }) {
    const { pipelineBuildCommand } = await import("../pipeline");
    await pipelineBuildCommand(buildCliConfig(args), getPositionals(args)[0]!, {
      ...scopeOptions(args),
      arguments: text(args.arguments),
      chainFamily: chain(text(args["chain-family"])),
    });
  },
});

function lifecycleDef(
  chainFamily: "evm" | "svm",
  lifecycle: "build" | "stage" | "simulate" | "commit",
) {
  return defineCommand({
    meta: {
      name: lifecycle,
      description: lifecycleDescription(chainFamily, lifecycle),
    },
    args: {
      ...pipelineArgs,
      input: {
        type: "positional",
        description: "JSON object, file path, @file, or - for stdin",
        required: true,
      },
      ...(lifecycle === "commit" ? idempotencyArg : {}),
    },
    async run({ args }) {
      const { pipelineLifecycleCommand } = await import("../pipeline");
      await pipelineLifecycleCommand(
        buildCliConfig(args),
        chainFamily,
        lifecycle,
        getPositionals(args)[0]!,
        text(args["idempotency-key"]),
      );
    },
  });
}

function chainDef(chainFamily: "evm" | "svm") {
  return defineCommand({
    meta: {
      name: chainFamily,
      description: `${chainFamily.toUpperCase()} raw Build lifecycle`,
    },
    subCommands: {
      build: lifecycleDef(chainFamily, "build"),
      stage: lifecycleDef(chainFamily, "stage"),
      simulate: lifecycleDef(chainFamily, "simulate"),
      commit: lifecycleDef(chainFamily, "commit"),
    },
  });
}

export const pipelineDef = defineCommand({
  meta: {
    name: "pipeline",
    description: "Discover, build, simulate, and commit Pipeline operations",
  },
  subCommands: {
    read: pipelineReadDef,
    apps: pipelineAppsDef,
    app: pipelineAppDef,
    skills: pipelineSkillsDef,
    skill: pipelineSkillDef,
    operations: pipelineOperationsDef,
    operation: pipelineOperationDef,
    invoke: pipelineInvokeDef,
    build: pipelineBuildDef,
    evm: chainDef("evm"),
    svm: chainDef("svm"),
  },
});

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function limit(value: unknown): number | undefined {
  const raw = text(value);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new TypeError("--limit must be a positive integer");
  }
  return parsed;
}

function listOptions(args: Record<string, unknown>) {
  return { filter: text(args.filter), limit: limit(args.limit) };
}

function scopeOptions(args: Record<string, unknown>) {
  return { app: text(args.app), skill: text(args.skill) };
}

function chain(value: string | undefined): "evm" | "svm" | undefined {
  const normalized = value?.toLowerCase();
  if (
    normalized === undefined ||
    normalized === "evm" ||
    normalized === "svm"
  ) {
    return normalized;
  }
  throw new TypeError("--chain-family must be evm or svm");
}

function lifecycleDescription(
  chainFamily: "evm" | "svm",
  lifecycle: "build" | "stage" | "simulate" | "commit",
): string {
  const chain = chainFamily.toUpperCase();
  switch (lifecycle) {
    case "build":
      return `Build and simulate an ${chain} operation or direct input`;
    case "stage":
      return `Stage ${chain} actions without simulation`;
    case "simulate":
      return `Simulate a staged ${chain} Build`;
    case "commit":
      return `Commit a simulated ${chain} Build`;
  }
}
