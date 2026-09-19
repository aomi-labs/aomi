import { getAddress, type Address } from "viem";

import type { Action } from "../../agent/types";
import { CliSession } from "../cli-session";
import { toEip5792SendCallsParams, type Eip5792CallInput } from "../eip5792";
import { fatal } from "../errors";
import type { CliConfig } from "../types";
import {
  formatWalletExport,
  parseWalletExportFormat,
  type WalletExportFormat,
} from "../wallet-export";

type EvmAction = Action & {
  request: Extract<Action["request"], { type: "execute_evm" }>;
};

export async function exportCommand(
  config: CliConfig,
  selectors: string[],
  rawFormat?: string,
): Promise<void> {
  if (selectors.length === 0) {
    fatal(
      "Usage: aomi tx export <action-id> [<action-id> ...]\nRun `aomi tx list` to see pending Actions.",
    );
  }

  let format: WalletExportFormat;
  try {
    format = parseWalletExportFormat(rawFormat);
  } catch (error) {
    fatal(errorMessage(error));
  }

  const cli = CliSession.load();
  if (!cli) fatal("No active session. Run `aomi chat` first.");
  cli.mergeConfig(config);
  const session = cli.createClientSession(config);
  try {
    await session.fetchCurrentState();
    const actions = resolveEvmActions(session.actions.pending(), selectors);
    const params = toSendCallsParams(actions, cli.publicKey);
    process.stdout.write(
      `${JSON.stringify(formatWalletExport(params, format), null, 2)}\n`,
    );
  } catch (error) {
    fatal(errorMessage(error));
  } finally {
    session.close();
  }
}

function resolveEvmActions(
  pending: readonly Action[],
  selectors: readonly string[],
): EvmAction[] {
  const selected = selectors.map((selector) => {
    const matches = pending.filter(
      (action) => action.id === selector || action.id.startsWith(selector),
    );
    if (matches.length > 1) {
      throw new Error(`Action selector "${selector}" is ambiguous.`);
    }
    const action = matches[0];
    if (!action) throw new Error(`Pending Action "${selector}" was not found.`);
    if (action.request.type !== "execute_evm") {
      throw new Error(`Action "${action.id}" is not an EVM execution Action.`);
    }
    return action as EvmAction;
  });

  if (new Set(selected.map((action) => action.id)).size !== selected.length) {
    throw new Error(
      "Duplicate Action IDs are not allowed in a single `aomi tx export` call.",
    );
  }
  return selected;
}

function toSendCallsParams(
  actions: readonly EvmAction[],
  sessionSender: string | undefined,
) {
  const transactions = actions.flatMap((action) => action.request.transactions);
  if (transactions.length === 0) {
    throw new Error("Selected Actions contain no EVM transactions.");
  }

  const senders = transactions.map((transaction, index) =>
    normalizeAddress(transaction.from, `Transaction ${index + 1} sender`),
  );
  const sender = senders[0]!;
  if (new Set(senders.map((value) => value.toLowerCase())).size !== 1) {
    throw new Error("Selected Actions must use one sender.");
  }
  if (sessionSender) {
    const active = normalizeAddress(sessionSender, "The active session sender");
    if (active.toLowerCase() !== sender.toLowerCase()) {
      throw new Error(
        `Action sender ${sender} does not match the active session sender ${active}.`,
      );
    }
  }

  const chainIds = transactions.map((transaction, index) => {
    if (
      !Number.isSafeInteger(transaction.chain_id) ||
      transaction.chain_id <= 0
    ) {
      throw new Error(`Transaction ${index + 1} has an invalid chain ID.`);
    }
    return transaction.chain_id;
  });
  const chainId = chainIds[0]!;
  if (new Set(chainIds).size !== 1) {
    throw new Error("Selected Actions must use one chain.");
  }

  const calls: Eip5792CallInput[] = transactions.map((transaction, index) => ({
    chainId: transaction.chain_id,
    to: transaction.to,
    data: transaction.data,
    value: parseValue(transaction.value, index),
  }));
  return toEip5792SendCallsParams({ from: sender, chainId, calls });
}

function normalizeAddress(value: string, label: string): Address {
  try {
    return getAddress(value);
  } catch {
    throw new Error(`${label} must be a valid EVM address.`);
  }
}

function parseValue(value: string | undefined, index: number): bigint {
  try {
    const parsed = BigInt(value ?? "0");
    if (parsed < BigInt(0)) throw new Error();
    return parsed;
  } catch {
    throw new Error(
      `Transaction ${index + 1} value must be a non-negative integer.`,
    );
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
