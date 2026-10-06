import { defineCommand } from "citty";
import { chatDef } from "./commands/defs/chat";
import { txDef } from "./commands/defs/tx";
import { sessionDef } from "./commands/defs/session";
import { modelDef } from "./commands/defs/model";
import { appDef } from "./commands/defs/app";
import { chainDef } from "./commands/defs/chain";
import { walletDef } from "./commands/defs/wallet";
import { accountDef } from "./commands/defs/account";
import { configDef } from "./commands/defs/config";
import { secretDef } from "./commands/defs/secret";
import { deployDef } from "./commands/defs/deploy";
import { pipelineDef } from "./commands/defs/pipeline";
import { buildCliConfig, globalArgs } from "./commands/defs/shared";
import packageJson from "../../package.json";

/**
 * Every token that resolves to a root subcommand. Kept in one place because
 * `main.ts` needs the same set for help routing — when the two lists drifted,
 * `deploy` was advertised in `--help` while being unreachable at runtime.
 */
export const SUBCOMMAND_NAMES = new Set([
  "chat",
  "tx",
  "session",
  "model",
  "app",
  "chain",
  "wallet",
  "account",
  "logout",
  "config",
  "secret",
  "deploy",
  "pipeline",
]);

export function hasRootSubcommand(rawArgs: string[]): boolean {
  return rawArgs.some((arg) => SUBCOMMAND_NAMES.has(arg));
}

const logoutDef = defineCommand({
  meta: {
    name: "logout",
    description: "Sign out and clear the CLI auth session",
  },
  args: { ...globalArgs },
  async run({ args }) {
    const { logoutCommand } = await import("./commands/account");
    await logoutCommand(buildCliConfig(args));
  },
});

export const root = defineCommand({
  meta: {
    name: "aomi",
    version: packageJson.version,
    description: "CLI client for Aomi on-chain agent",
  },
  args: {
    ...globalArgs,
    prompt: {
      type: "string",
      alias: "p",
      description: "Send a single prompt and exit",
    },
    "show-tool": {
      type: "boolean",
      description: "Show tool output while chatting from root mode",
    },
    "provider-key": {
      type: "string",
      description: "Use your own provider API key. Format: PROVIDER:KEY",
    },
  },
  async run({ args, rawArgs }) {
    // citty 0.2.2 quirk: when a subCommand is matched, it runs the subcommand
    // AND still falls through to the parent's `run`. Bail out here if rawArgs
    // contain a known subcommand token — otherwise every `aomi wallet set …`
    // or `aomi tx sign …` would spuriously try to start the REPL and exit 1
    // on non-TTY.
    if (hasRootSubcommand(rawArgs)) {
      return;
    }
    const { runRootCli } = await import("./repl");
    await runRootCli(args);
  },
  subCommands: {
    chat: chatDef,
    tx: txDef,
    session: sessionDef,
    model: modelDef,
    app: appDef,
    chain: chainDef,
    wallet: walletDef,
    account: accountDef,
    logout: logoutDef,
    config: configDef,
    secret: secretDef,
    deploy: deployDef,
    pipeline: pipelineDef,
  },
});
