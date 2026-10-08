import { defineCommand } from "citty";
import { fatal } from "../../errors";
import { globalArgs, buildCliConfig, getPositionals } from "./shared";

function exactPositionals(
  args: Record<string, unknown>,
  count: number,
  usage: string,
): string[] {
  const values = getPositionals(args);
  if (values.length !== count) fatal(`Usage: ${usage}`);
  return values;
}

const appListDef = defineCommand({
  meta: { name: "list", description: "List account apps and install status" },
  args: { ...globalArgs },
  async run({ args }) {
    const { accountAppsCommand } = await import("../apps");
    await accountAppsCommand(buildCliConfig(args));
  },
});

const appAvailableDef = defineCommand({
  meta: { name: "available", description: "List executable Pipeline apps" },
  args: { ...globalArgs },
  async run({ args }) {
    const { appsCommand } = await import("../control");
    await appsCommand(buildCliConfig(args));
  },
});

function appMutationDef(name: "add" | "remove") {
  return defineCommand({
    meta: {
      name,
      description: `${name === "add" ? "Install" : "Uninstall"} an account app`,
    },
    args: {
      ...globalArgs,
      target: {
        type: "positional",
        description: "App name or application ID",
        required: false,
      },
    },
    async run({ args }) {
      const [target] = exactPositionals(args, 1, `aomi app ${name} <app>`);
      const commands = await import("../apps");
      await (name === "add"
        ? commands.addAccountAppCommand(buildCliConfig(args), target)
        : commands.removeAccountAppCommand(buildCliConfig(args), target));
    },
  });
}

const credentialStatusDef = defineCommand({
  meta: { name: "status", description: "Show credential setup status" },
  args: {
    ...globalArgs,
    target: {
      type: "positional",
      description: "App name or application ID",
      required: false,
    },
  },
  async run({ args }) {
    const [target] = exactPositionals(
      args,
      1,
      "aomi app credentials status <app>",
    );
    const { appCredentialStatusCommand } = await import("../apps");
    await appCredentialStatusCommand(buildCliConfig(args), target);
  },
});

function credentialWriteDef(name: "set" | "replace") {
  return defineCommand({
    meta: {
      name,
      description: `${name === "set" ? "Set" : "Replace"} a credential using a secure prompt or stdin`,
    },
    args: {
      ...globalArgs,
      target: {
        type: "positional",
        description: "App name or application ID",
        required: false,
      },
      credential: {
        type: "positional",
        description: "Declared credential name",
        required: false,
      },
    },
    async run({ args }) {
      const [target, credential] = exactPositionals(
        args,
        2,
        `aomi app credentials ${name} <app> <name>`,
      );
      const { setAppCredentialCommand } = await import("../apps");
      await setAppCredentialCommand(buildCliConfig(args), target, credential, {
        replace: name === "replace",
      });
    },
  });
}

const credentialRemoveDef = defineCommand({
  meta: { name: "remove", description: "Remove one saved credential" },
  args: {
    ...globalArgs,
    target: {
      type: "positional",
      description: "App name or application ID",
      required: false,
    },
    credential: {
      type: "positional",
      description: "Declared credential name",
      required: false,
    },
  },
  async run({ args }) {
    const [target, credential] = exactPositionals(
      args,
      2,
      "aomi app credentials remove <app> <name>",
    );
    const { removeAppCredentialCommand } = await import("../apps");
    await removeAppCredentialCommand(buildCliConfig(args), target, credential);
  },
});

const appCredentialsDef = defineCommand({
  meta: { name: "credentials", description: "Per-user app credentials" },
  subCommands: {
    status: credentialStatusDef,
    set: credentialWriteDef("set"),
    replace: credentialWriteDef("replace"),
    remove: credentialRemoveDef,
  },
});

const appCurrentDef = defineCommand({
  meta: { name: "current", description: "Show the current app" },
  args: { ...globalArgs },
  async run({ args }) {
    const { currentAppCommand } = await import("../control");
    currentAppCommand(buildCliConfig(args));
  },
});

export const appDef = defineCommand({
  meta: { name: "app", description: "App management" },
  subCommands: {
    list: appListDef,
    available: appAvailableDef,
    add: appMutationDef("add"),
    remove: appMutationDef("remove"),
    credentials: appCredentialsDef,
    current: appCurrentDef,
  },
});
