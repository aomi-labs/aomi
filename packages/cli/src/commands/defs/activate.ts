import { defineCommand } from "citty";

export const activateDef = defineCommand({
  meta: {
    name: "activate",
    description: "Activate a deployment by promoting release tags",
  },
  args: {
    "deployment-id": {
      type: "string",
      description: "Deployment ID (reads .aomi/deployment.json if absent)",
    },
    "release-tags": {
      type: "string",
      description:
        "Comma-separated release tags to activate (reads .aomi/deployment.json if absent)",
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
    const { activateCommand } = await import("../activate");
    await activateCommand(args);
  },
});
