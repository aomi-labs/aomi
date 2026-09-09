import { runCommand, runMain } from "citty";
import { root, SUBCOMMAND_NAMES } from "./root";
import { CliExit, DeployCliError } from "./errors";
import packageJson from "../../package.json";

const ROOT_SUBCOMMANDS = SUBCOMMAND_NAMES;

function isPnpmExecWrapper(): boolean {
  const npmCommand = process.env.npm_command ?? "";
  const userAgent = process.env.npm_config_user_agent ?? "";
  return npmCommand === "exec" && userAgent.includes("pnpm/");
}

function shouldPrintRootHelp(rawArgs: string[]): boolean {
  if (!rawArgs.includes("--help") && !rawArgs.includes("-h")) {
    return false;
  }

  const firstToken = rawArgs.find((arg) => !arg.startsWith("-"));
  return !firstToken || !ROOT_SUBCOMMANDS.has(firstToken);
}

function printRootHelp(): void {
  console.log(
    `CLI client for Aomi on-chain agent (aomi v${packageJson.version})`,
  );
  console.log("");
  console.log("USAGE");
  console.log("");
  console.log("  aomi");
  console.log("  aomi --prompt <prompt> [OPTIONS]");
  console.log("  aomi [OPTIONS] <command>");
  console.log("");
  console.log("ROOT MODES");
  console.log("");
  console.log("  aomi                         Start the interactive REPL");
  console.log('  aomi --prompt "hello"        Send one prompt and exit');
  console.log("");
  console.log("REPL COMMANDS");
  console.log("");
  console.log("  /heap                        Show REPL help");
  console.log("  /app <name>                  Switch the active app");
  console.log("  /model <rig>|list|show       Manage the active model");
  console.log("  /key <provider:key>|show|clear");
  console.log("                               Manage BYOK provider keys");
  console.log("  :exit                        Quit the CLI");
  console.log("");
  console.log("OPTIONS");
  console.log("");
  console.log("  --backend-url <url>          Backend URL");
  console.log("  --api-key <key>              API key for non-default apps");
  console.log(
    "  --account-bearer <token>     Aomi account bearer for authenticated requests",
  );
  console.log(
    "  --json                       Print machine-readable JSON where supported",
  );
  console.log("  --verbose                    Show extra diagnostics");
  console.log("  --app <name>                 Active app");
  console.log("  --application-id <id>        Hosted app discovery identity");
  console.log("  --platform <name>            Hosted app discovery platform");
  console.log("  --model <rig>                Active model");
  console.log("  --new-session                Create a fresh active session");
  console.log(
    "  --chain <id>                 Active chain for chat/session context",
  );
  console.log("  --public-key <address>       Wallet address for chat context");
  console.log("  --private-key <hex>          Signing key for EVM tx sign");
  console.log(
    "  --payment-method <method>    Paid Agent/Pipeline rail, e.g. coinbase/x402",
  );
  console.log(
    "  --solana-private-key <key>   Solana keypair (base58 or JSON byte array)",
  );
  console.log("  --rpc-url <url>              RPC URL for signing");
  console.log("  -p, --prompt <prompt>        Send a single prompt and exit");
  console.log(
    "  --show-tool                  Show tool output in root prompt/REPL mode",
  );
  console.log("  --provider-key <provider:key>");
  console.log(
    "                               Save a BYOK provider key before running",
  );
  console.log("");
  console.log("COMMANDS");
  console.log("");
  console.log("  chat                         Explicit one-shot chat command");
  console.log("  tx                           Transaction management");
  console.log("  session                      Session management");
  console.log("  model                        Model management");
  console.log("  app                          App management");
  console.log("  chain                        Chain information");
  console.log("  wallet                       Wallet configuration");
  console.log(
    "  account                      Account login and link management",
  );
  console.log(
    "  logout                       Sign out and clear the CLI auth session",
  );
  console.log("  config                       CLI configuration");
  console.log("  secret                       Secret management");
  console.log(
    "  deploy                       Deploy your app (also: deploy status, deploy activate)",
  );
  console.log(
    "  pipeline                     Pipeline discovery and Build lifecycle",
  );
  console.log("");
  console.log("Use aomi <command> --help for command-specific details.");
}

export async function runCli(argv: string[] = process.argv): Promise<void> {
  const strictExit = process.env.AOMI_CLI_STRICT_EXIT === "1";
  const rawArgs = argv.slice(2);

  try {
    if (shouldPrintRootHelp(rawArgs)) {
      printRootHelp();
      return;
    }

    if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
      await runMain(root, { rawArgs });
      return;
    }

    if (
      rawArgs.length === 1 &&
      (rawArgs[0] === "--version" || rawArgs[0] === "-v")
    ) {
      await runMain(root, { rawArgs });
      return;
    }

    await runCommand(root, { rawArgs });
  } catch (err) {
    if (err instanceof CliExit) {
      if (!strictExit && isPnpmExecWrapper()) {
        return;
      }
      process.exit(err.code);
      return;
    }
    const RED = "\x1b[31m";
    const RESET = "\x1b[0m";
    if (err instanceof DeployCliError) {
      console.error(`${RED}❌ [${err.errorCode}] ${err.message}${RESET}`);
      process.exit(1);
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${RED}❌ ${message}${RESET}`);
    process.exit(1);
  }
}
