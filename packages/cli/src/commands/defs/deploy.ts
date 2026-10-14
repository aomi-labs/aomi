import { defineCommand } from "citty";
import { statusDef } from "./status";
import { activateDef } from "./activate";

export const deployDef = defineCommand({
  meta: {
    name: "deploy",
    description: "Deploy your app to the Aomi platform",
  },
  args: {
    "backend-url": {
      type: "string",
      description: "Backend URL (default: https://api.aomi.dev)",
    },
    "activation-token": {
      type: "string",
      description:
        "Platform activation token (required; or set AOMI_DEPLOY_TOKEN env)",
    },
    "project-id": {
      type: "string",
      description: "Backend project ID (required; or set AOMI_PROJECT_ID env)",
    },
    preflight: {
      type: "boolean",
      description: "Preview the deployment manifest without applying it",
    },
    branch: {
      type: "string",
      description:
        "Git branch to deploy (default: current branch via git rev-parse)",
    },
    commit: {
      type: "string",
      description: "Deploy a specific commit SHA instead of a branch tip",
    },
    platform: {
      type: "string",
      description:
        "Authentication platform for browser login (the Project determines the deployment platform)",
    },
  },
  async run({ args }) {
    const { deployCommand } = await import("../deploy");
    await deployCommand(args);
  },
  subCommands: {
    status: statusDef,
    activate: activateDef,
  },
});
