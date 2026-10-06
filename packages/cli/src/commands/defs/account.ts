import { defineCommand } from "citty";
import { buildCliConfig, globalArgs } from "./shared";

const accountLoginDef = defineCommand({
  meta: {
    name: "login",
    description: "Sign in to an Aomi account",
  },
  args: {
    ...globalArgs,
    provider: {
      type: "string",
      description: 'Browser auth provider ("privy" or "para")',
    },
    wallet: {
      type: "boolean",
      description: "Use native CLI SIWE with the configured EVM wallet",
    },
    solana: {
      type: "boolean",
      description: "Use native CLI SIWS with the configured Solana wallet",
    },
    "no-browser": {
      type: "boolean",
      description: "Do not open provider auth; use native CLI SIWE",
    },
  },
  async run({ args }) {
    const { accountLoginCommand } = await import("../account");
    await accountLoginCommand(buildCliConfig(args), {
      provider: typeof args.provider === "string" ? args.provider : undefined,
      wallet: args.wallet === true,
      solana: args.solana === true,
      noBrowser: args["no-browser"] === true,
    });
  },
});

const accountWhoamiDef = defineCommand({
  meta: {
    name: "whoami",
    description: "Show the authenticated backend account",
  },
  args: { ...globalArgs },
  async run({ args }) {
    const { accountWhoamiCommand } = await import("../account");
    await accountWhoamiCommand(buildCliConfig(args));
  },
});

const accountLogoutDef = defineCommand({
  meta: {
    name: "logout",
    description: "Sign out and clear the CLI auth session",
  },
  args: { ...globalArgs },
  async run({ args }) {
    const { logoutCommand } = await import("../account");
    await logoutCommand(buildCliConfig(args));
  },
});

const accountLinksDef = defineCommand({
  meta: {
    name: "links",
    description: "List account login methods and linked wallets",
  },
  args: { ...globalArgs },
  async run({ args }) {
    const { accountLinksCommand } = await import("../account");
    await accountLinksCommand(buildCliConfig(args));
  },
});

const accountLinkDef = defineCommand({
  meta: {
    name: "link",
    description: "Link a wallet or provider login method to the account",
  },
  args: {
    ...globalArgs,
    provider: {
      type: "string",
      description: 'Provider login method to link ("privy" or "para")',
    },
    wallet: {
      type: "boolean",
      description: "Link an EVM wallet with SIWE (default)",
    },
    solana: {
      type: "boolean",
      description: "Link a Solana wallet with SIWS",
    },
    label: {
      type: "string",
      description: "Optional display label for the linked wallet",
    },
  },
  async run({ args }) {
    const { accountLinkCommand } = await import("../account");
    await accountLinkCommand(buildCliConfig(args), {
      provider: typeof args.provider === "string" ? args.provider : undefined,
      wallet: args.wallet === true,
      solana: args.solana === true,
      label: typeof args.label === "string" ? args.label : undefined,
    });
  },
});

const accountUnlinkDef = defineCommand({
  meta: {
    name: "unlink",
    description: "Unlink an account login method or linked wallet",
  },
  args: {
    ...globalArgs,
    id: {
      type: "positional",
      description: "Link id, identity:<id>, or wallet:<id>",
      required: true,
    },
    yes: {
      type: "boolean",
      description: "Confirm unlinking",
    },
  },
  async run({ args }) {
    const { accountUnlinkCommand } = await import("../account");
    await accountUnlinkCommand(buildCliConfig(args), args.id, {
      yes: args.yes === true,
    });
  },
});

const accountRenameDef = defineCommand({
  meta: {
    name: "rename",
    description: "Rename an account login method or linked wallet",
  },
  args: {
    ...globalArgs,
    id: {
      type: "positional",
      description: "Link id, identity:<id>, or wallet:<id>",
      required: true,
    },
    label: {
      type: "string",
      description: "Display label",
      required: true,
    },
  },
  async run({ args }) {
    const { accountRenameCommand } = await import("../account");
    await accountRenameCommand(buildCliConfig(args), args.id, {
      label: typeof args.label === "string" ? args.label : undefined,
    });
  },
});

const accountUpdateDef = defineCommand({
  meta: {
    name: "update",
    description: "Update the account profile",
  },
  args: {
    ...globalArgs,
    "display-name": {
      type: "string",
      description: "Display name",
    },
    "avatar-url": {
      type: "string",
      description: "Avatar URL",
    },
  },
  async run({ args }) {
    const { accountUpdateCommand } = await import("../account");
    await accountUpdateCommand(buildCliConfig(args), {
      displayName:
        typeof args["display-name"] === "string"
          ? args["display-name"]
          : undefined,
      avatarUrl:
        typeof args["avatar-url"] === "string" ? args["avatar-url"] : undefined,
    });
  },
});

const accountDeleteDef = defineCommand({
  meta: {
    name: "delete",
    description: "Delete the Aomi account",
  },
  args: {
    ...globalArgs,
    yes: {
      type: "boolean",
      description: "Confirm account deletion",
    },
  },
  async run({ args }) {
    const { accountDeleteCommand } = await import("../account");
    await accountDeleteCommand(buildCliConfig(args), {
      yes: args.yes === true,
    });
  },
});

const accountSessionsDef = defineCommand({
  meta: {
    name: "sessions",
    description: "List local CLI sessions for account switching",
  },
  args: { ...globalArgs },
  async run({ args }) {
    const { accountSessionsCommand } = await import("../account");
    await accountSessionsCommand(buildCliConfig(args));
  },
});

const accountSwitchDef = defineCommand({
  meta: {
    name: "switch",
    description: "Switch the active local CLI session",
  },
  args: {
    id: {
      type: "positional",
      description: "Session ID or session-N",
      required: true,
    },
  },
  async run({ args }) {
    const { accountSwitchCommand } = await import("../account");
    accountSwitchCommand(args.id);
  },
});

const accountCreditsShowDef = defineCommand({
  meta: {
    name: "show",
    description: "Show allowance, purchased balance, and recent activity",
  },
  args: {
    ...globalArgs,
    limit: {
      type: "string",
      description: "Recent activity rows (1-100, default: 25)",
    },
    before: {
      type: "string",
      description: "Load activity before this entry id",
    },
  },
  async run({ args }) {
    const { accountCreditsShowCommand } = await import("../account");
    await accountCreditsShowCommand(buildCliConfig(args), {
      limit: typeof args.limit === "string" ? args.limit : undefined,
      before: typeof args.before === "string" ? args.before : undefined,
    });
  },
});

const accountCreditsTopUpDef = defineCommand({
  meta: {
    name: "top-up",
    description: "Purchase durable credits with the configured EVM wallet",
  },
  args: {
    ...globalArgs,
    credits: {
      type: "positional",
      description: "Credits to purchase (1-100000, up to 4 decimals)",
      required: true,
    },
    "idempotency-key": {
      type: "string",
      description: "Purchase key; reuse the same key when retrying",
      required: true,
    },
  },
  async run({ args }) {
    const { accountCreditsTopUpCommand } = await import("../account");
    await accountCreditsTopUpCommand(buildCliConfig(args), args.credits, {
      idempotencyKey:
        typeof args["idempotency-key"] === "string"
          ? args["idempotency-key"]
          : undefined,
    });
  },
});

const accountCreditsDef = defineCommand({
  meta: {
    name: "credits",
    description: "Included allowance, Credit Bank activity, and wallet top-ups",
  },
  subCommands: {
    show: accountCreditsShowDef,
    "top-up": accountCreditsTopUpDef,
  },
});

export const accountDef = defineCommand({
  meta: { name: "account", description: "Account authentication" },
  subCommands: {
    login: accountLoginDef,
    whoami: accountWhoamiDef,
    logout: accountLogoutDef,
    links: accountLinksDef,
    link: accountLinkDef,
    unlink: accountUnlinkDef,
    rename: accountRenameDef,
    update: accountUpdateDef,
    delete: accountDeleteDef,
    sessions: accountSessionsDef,
    switch: accountSwitchDef,
    credits: accountCreditsDef,
  },
});
