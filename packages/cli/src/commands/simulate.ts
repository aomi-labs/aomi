import { summarizeSimulation } from "../../simulation";
import type { Action } from "../../agent/types";
import { CliSession } from "../cli-session";
import { createCliClient } from "../client-factory";
import { fatal } from "../errors";
import { DIM, GREEN, RESET } from "../output";
import type { CliConfig } from "../types";

export async function simulateCommand(
  config: CliConfig,
  selectors: string[],
): Promise<void> {
  const cli = CliSession.load();
  if (!cli) fatal("No active session. Run `aomi chat` first.");
  if (selectors.length === 0) {
    fatal(
      "Usage: aomi tx simulate <action-id> [<action-id> ...]\nRun `aomi tx list` to see pending Actions.",
    );
  }

  const session = cli.createClientSession(config);
  let actions: Action[];
  try {
    await session.fetchCurrentState();
    const pending = session.actions.pending();
    actions = selectors.map((selector) => resolveAction(pending, selector));
  } finally {
    session.close();
  }
  const transactions = actions.flatMap((action) => {
    if (action.request.type !== "execute_evm") {
      fatal(`Action "${action.id}" is not an EVM execution Action.`);
    }
    return action.request.transactions.map((transaction) => ({
      to: transaction.to,
      value: transaction.value,
      data: transaction.data,
      label: transaction.label,
      chain_id: transaction.chain_id,
    }));
  });

  console.log(
    `${DIM}Simulating ${transactions.length} transaction(s) as an atomic batch...${RESET}`,
  );
  const client = createCliClient(
    { ...config, secrets: config.secrets ?? {} },
    { baseUrl: cli.baseUrl, apiKey: cli.apiKey },
  );
  const { result, fee } = await client.simulateBatch(
    cli.sessionId,
    transactions,
    {
      from: cli.publicKey,
      chainId: cli.chainId,
    },
  );

  const summary = summarizeSimulation(result);
  if (!summary)
    fatal(
      "Unsupported simulation response; update client and backend together.",
    );
  console.log("\nStateful call simulation:");
  for (const context of result.contexts) {
    console.log(
      `From: ${context.sender} | Chain: ${context.chain_id} | Block: ${context.block_number}`,
    );
  }
  for (const step of result.steps) {
    const execution = step.execution;
    const passed = execution?.status.kind === "succeeded";
    const icon = !execution
      ? `${DIM}–${RESET}`
      : passed
        ? `${GREEN}✓${RESET}`
        : `\x1b[31m✗${RESET}`;
    const gas = execution?.gas_used
      ? ` | gas: ${execution.gas_used.toLocaleString()}`
      : "";
    console.log(`  ${icon} ${step.step}. ${step.label || `Step ${step.step}`}`);
    console.log(
      `    ${DIM}to: ${step.call.to} | value: ${step.call.value} native atomic units (chain ${step.chain_id})${gas}${RESET}`,
    );
    if (!passed) {
      console.log(`    Status: ${execution?.status.kind ?? "skipped"}`);
      if (execution?.status.kind === "halted")
        console.log(`    ${execution.status.reason}`);
      if (execution?.return_data && execution.return_data !== "0x")
        console.log(`    Return data: ${execution.return_data}`);
    }
  }
  if (summary.gas) {
    console.log(
      `\n${DIM}Successful-step gas: ${summary.gas.toLocaleString()}${RESET}`,
    );
  }
  if (fee) {
    const amount = BigInt(fee.amount_wei);
    console.log(
      `Service fee: ${amount} native atomic units → ${fee.recipient}`,
    );
  }
  console.log(
    summary.passed
      ? `\n${GREEN}All steps passed.${RESET}`
      : `\n\x1b[31mBatch failed.${RESET}`,
  );
}

function resolveAction(actions: Action[], selector: string): Action {
  const matches = actions.filter(
    (action) => action.id === selector || action.id.startsWith(selector),
  );
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) fatal(`Action selector "${selector}" is ambiguous.`);
  fatal(`Pending Action "${selector}" was not found.`);
}
