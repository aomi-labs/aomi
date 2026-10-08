import { defineCommand } from "citty";

export const statusDef = defineCommand({
  meta: {
    name: "status",
    description: "Show current deployment status",
  },
  args: {
    "deployment-id": {
      type: "string",
      description: "Deployment ID (reads .aomi/deployment.json if absent)",
    },
    watch: {
      type: "boolean",
      description: "Poll until a terminal state is reached",
    },
    "activation-token": {
      type: "string",
      description: "Platform activation token (or set AOMI_DEPLOY_TOKEN env)",
    },
    "backend-url": {
      type: "string",
      description: "Backend URL (default: https://api.aomi.dev)",
    },
    platform: {
      type: "string",
      description: "Deploy platform (default: community; or set AOMI_DEPLOY_PLATFORM env)",
    },
  },
  async run({ args }) {
    const { statusCommand } = await import("../status");
    await statusCommand(args);
  },
});
