import type { Action } from "../../agent/types";
import { CliSession } from "../cli-session";
import { CliExit, fatal } from "../errors";
import { printDataFileLocation, printJson } from "../output";
import type { CliConfig } from "../types";

export async function txCommand(config: CliConfig): Promise<void> {
  const cli = CliSession.load();
  if (!cli) {
    if (config.json) printJson({ active: false, actions: [] });
    else {
      console.log("No active session");
      printDataFileLocation({ verbose: config.verbose });
    }
    return;
  }

  const session = cli.createClientSession(config);
  try {
    await session.fetchCurrentState();
    const actions = session.actions.all();
    if (config.json) {
      printJson({ active: true, actions });
      return;
    }
    if (actions.length === 0) {
      console.log("No Actions.");
      printDataFileLocation({ verbose: config.verbose });
      return;
    }
    for (const action of actions) console.log(formatAction(action));
    printDataFileLocation({ verbose: config.verbose });
  } finally {
    session.close();
  }
}

export async function signCommand(
  config: CliConfig,
  selectors: string[],
): Promise<void> {
  if (selectors.length === 0) {
    fatal(
      "Usage: aomi tx sign <action-id> [<action-id> ...]\nRun `aomi tx list` to see pending Actions.",
    );
  }
  if (new Set(selectors).size !== selectors.length) {
    fatal("Duplicate Action IDs are not allowed.");
  }
  if (config.execution === "aa") {
    fatal(
      "AA execution is owned by the backend; local Action execution is EOA.",
    );
  }

  const cli = CliSession.load();
  if (!cli) fatal("No active session. Run `aomi chat` first.");
  cli.mergeConfig(config);
  const session = cli.createClientSession(config);
  try {
    await session.fetchCurrentState();
    const actions = selectors.map((selector) =>
      resolveAction(session.actions.pending(), selector),
    );
    for (const action of actions) {
      if (!session.actions.canExecute(action.id)) {
        fatal(missingCapability(action));
      }
      console.log(formatAction(action));
      const resolved = await session.actions.execute(action.id);
      console.log(`✅ ${resolved.id} ${resolved.state}`);
    }
  } catch (error) {
    if (error instanceof CliExit) throw error;
    fatal(
      `❌ Action failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    session.close();
  }
}

function resolveAction(actions: Action[], selector: string): Action {
  const matches = actions.filter(
    (action) => action.id === selector || action.id.startsWith(selector),
  );
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) fatal(`Action selector "${selector}" is ambiguous.`);
  fatal(`Pending Action "${selector}" was not found.`);
}

function formatAction(action: Action): string {
  const request = action.request;
  const detail =
    request.type === "execute_evm"
      ? `${request.transactions.length} EVM transaction${request.transactions.length === 1 ? "" : "s"}`
      : request.type === "execute_svm"
        ? `${request.transactions.length} SVM transaction${request.transactions.length === 1 ? "" : "s"}`
        : `${request.chainFamily.toUpperCase()} signature`;
  return `${action.state === "pending" ? "⏳" : "✅"} ${action.id}  ${detail}  (${action.state}, revision ${action.revision})`;
}

function missingCapability(action: Action): string {
  if (
    action.request.type === "execute_svm" ||
    (action.request.type === "sign" && action.request.chainFamily === "svm")
  ) {
    return "A Solana key is required. Run `aomi wallet set --solana <key>` or pass --solana-private-key.";
  }
  return "An EVM private key is required. Run `aomi wallet set <hex-key>` or pass --private-key.";
}
