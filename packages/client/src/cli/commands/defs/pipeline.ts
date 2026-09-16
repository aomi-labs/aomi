import { defineCommand } from "citty";
import { buildCliConfig, getPositionals, globalArgs } from "./shared";

const discoveryArgs = {
  ...globalArgs,
  query: { type: "string", alias: "q", description: "Ranked search query" },
  limit: { type: "string", description: "Maximum results (server-bounded)" },
} as const;

const pipelineAppsDef = defineCommand({
  meta: { name: "apps", description: "List or search Pipeline apps" },
  args: discoveryArgs,
  async run({ args }) {
    const { pipelineAppsCommand } = await import("../pipeline");
    await pipelineAppsCommand(buildCliConfig(args), {
      query: text(args.query),
      limit: limit(args.limit),
    });
  },
});

const pipelineAppDef = defineCommand({
  meta: { name: "app", description: "Describe one Pipeline app" },
  args: {
    ...globalArgs,
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

const pipelineToolsDef = defineCommand({
  meta: { name: "tools", description: "List or search Pipeline tools" },
  args: {
    ...discoveryArgs,
    namespace: { type: "string", description: "Namespace filter" },
  },
  async run({ args }) {
    const { pipelineToolsCommand } = await import("../pipeline");
    const config = buildCliConfig(args);
    await pipelineToolsCommand(config, {
      query: text(args.query),
      app: config.app,
      namespace: text(args.namespace),
      limit: limit(args.limit),
    });
  },
});

const pipelineToolDef = defineCommand({
  meta: { name: "tool", description: "Describe one Pipeline tool" },
  args: {
    ...globalArgs,
    toolId: {
      type: "positional",
      description: "Tool id",
      required: true,
    },
  },
  async run({ args }) {
    const { pipelineToolCommand } = await import("../pipeline");
    const config = buildCliConfig(args);
    await pipelineToolCommand(config, getPositionals(args)[0]!, config.app);
  },
});

const pipelineSkillsDef = defineCommand({
  meta: { name: "skills", description: "List Pipeline skills" },
  args: discoveryArgs,
  async run({ args }) {
    const { pipelineSkillsCommand } = await import("../pipeline");
    await pipelineSkillsCommand(buildCliConfig(args), limit(args.limit));
  },
});

const pipelineSkillDef = defineCommand({
  meta: { name: "skill", description: "Describe one Pipeline skill" },
  args: {
    ...globalArgs,
    skillId: {
      type: "positional",
      description: "Skill id",
      required: true,
    },
  },
  async run({ args }) {
    const { pipelineSkillCommand } = await import("../pipeline");
    await pipelineSkillCommand(buildCliConfig(args), getPositionals(args)[0]!);
  },
});

const executionArgs = {
  ...globalArgs,
  "idempotency-key": {
    type: "string",
    description:
      "Stable key for this logical execution; reuse it for a manual retry",
    required: true,
  },
} as const;

const pipelineCallDef = defineCommand({
  meta: {
    name: "call",
    description:
      "Call a builtin public Pipeline tool through backend policy gates",
  },
  args: {
    ...executionArgs,
    toolId: {
      type: "positional",
      description: "Tool id",
      required: true,
    },
    arguments: {
      type: "string",
      description: "Tool arguments as a JSON object",
    },
  },
  async run({ args }) {
    const { pipelineCallCommand } = await import("../pipeline");
    const config = buildCliConfig(args);
    await pipelineCallCommand(config, {
      toolId: getPositionals(args)[0]!,
      arguments: text(args.arguments),
      app: config.app,
      applicationId: config.applicationId,
      platform: config.appPlatform,
      idempotencyKey: text(args["idempotency-key"])!,
    });
  },
});

export const pipelineDef = defineCommand({
  meta: {
    name: "pipeline",
    description: "Pipeline discovery and builtin policy-gated execution",
  },
  subCommands: {
    apps: pipelineAppsDef,
    app: pipelineAppDef,
    tools: pipelineToolsDef,
    tool: pipelineToolDef,
    skills: pipelineSkillsDef,
    skill: pipelineSkillDef,
    call: pipelineCallDef,
  },
});

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function limit(value: unknown): number | undefined {
  const parsed = Number(text(value));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function list(value: unknown): string[] | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const values = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length ? values : undefined;
}
