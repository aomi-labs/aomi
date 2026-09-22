import { CliSession } from "../cli-session";
import {
  DIM,
  RESET,
  YELLOW,
  getToolNameFromEvent,
  getToolResultFromEvent,
  isAlwaysVisibleTool,
  inlineToolResultFromMessage,
  printNewAgentMessages,
  printPaymentEvent,
  printTaskActivity,
  printTaskCompleted,
  printTaskStarted,
  printToolComplete,
  printToolResultLine,
} from "../output";
import {
  applyRequestedModelIfPresent,
  ingestSecretsForSession,
} from "../context";
import { fatal } from "../errors";
import type { CliConfig } from "../types";
import { parseSolanaKeypairSecret } from "../solana-signer";
import type { ClientSession } from "../../session";
import type { Event, MessageEvent } from "../../agent/types";

const STOPPED_TURN_STATES = new Set([
  "awaiting_action",
  "complete",
  "interrupted",
  "failed",
]);

function waitForTurnStop(session: ClientSession): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      const state = session.getSnapshot().turnState;
      if (!state || !STOPPED_TURN_STATES.has(state)) return;
      unsubscribe();
      resolve();
    };
    const unsubscribe = session.subscribe(check);
    check();
  });
}

/**
 * Derive the Solana public key from a keypair secret string if provided.
 * Returns undefined on any parse failure (non-fatal — just omits svm.address).
 */
function deriveSvmAddress(
  solanaPrivateKey: string | undefined,
): string | undefined {
  if (!solanaPrivateKey) return undefined;
  try {
    return parseSolanaKeypairSecret(solanaPrivateKey).publicKey.toBase58();
  } catch {
    return undefined;
  }
}

export function resolveSvmAddressForChat(
  persistedSvmAddress: string | undefined,
  solanaPrivateKey: string | undefined,
): string | undefined {
  return deriveSvmAddress(solanaPrivateKey) ?? persistedSvmAddress;
}

export function printBoundaryForTurn(
  events: readonly Event[],
  messages: readonly MessageEvent[],
  turnId: string | undefined,
) {
  const firstTurnEvent = events.find((event) => event.turn_id === turnId);
  return {
    handledSequence: firstTurnEvent ? firstTurnEvent.sequence - 1 : 0,
    printedAgentCount: messages.filter(
      (message) => message.sender === "agent" && message.turn_id !== turnId,
    ).length,
  };
}

export async function chatCommand(
  config: CliConfig,
  message: string,
  verbose: boolean,
): Promise<void> {
  if (!message) {
    fatal("Usage: aomi chat <message>");
  }

  const cli = CliSession.loadOrCreate(config);
  const session = cli.createClientSession(config, {
    onPayment: printPaymentEvent,
  });

  try {
    await ingestSecretsForSession(config, cli, session.client);
    await applyRequestedModelIfPresent(config, cli, session);
    const previousActionIds = new Set(
      session.actions.all().map((action) => action.id),
    );
    let printedAgentCount = 0;
    let handledSequence = 0;
    let thinkingPrinted = false;
    const agentLabels = new Map<string, string>();
    // One printed line per (turn, tool) pair, whichever wire shape lands
    // first. Suppressing by turn alone silently drops a distinct tool's only
    // trace whenever another tool in the turn used the other shape.
    const seenToolPairs = new Set<string>();
    const toolPairKey = (turnId: string, name: string) =>
      `${turnId}::${name}`;
    const render = () => {
      const snapshot = session.getSnapshot();
      if (
        verbose &&
        !thinkingPrinted &&
        (snapshot.isSubmitting || snapshot.turnState === "processing")
      ) {
        thinkingPrinted = true;
        console.log(`${DIM}⏳ Thinking…${RESET}`);
      }
      for (const event of snapshot.events) {
        if (event.sequence <= handledSequence) continue;
        handledSequence = event.sequence;
        if (event.type === "tool_complete") {
          const name = getToolNameFromEvent(event);
          // Subagent lifecycles print through the task_* lines, not as tools.
          if (name === "task") continue;
          const turnId = event.turn_id ?? `event:${event.event_id}`;
          const pair = toolPairKey(turnId, name);
          const firstForPair = !seenToolPairs.has(pair);
          seenToolPairs.add(pair);
          if (firstForPair && (verbose || isAlwaysVisibleTool(name))) {
            printToolComplete(event);
          }
        } else if (event.type === "message") {
          const tool = inlineToolResultFromMessage(event);
          if (tool) {
            const pair = toolPairKey(tool.turnId, tool.name);
            const firstForPair = !seenToolPairs.has(pair);
            seenToolPairs.add(pair);
            if (firstForPair && (verbose || isAlwaysVisibleTool(tool.name))) {
              printToolResultLine(tool.name, tool.result);
            }
          } else if (verbose && event.sender === "notice") {
            console.log(`${YELLOW}📢 ${event.content}${RESET}`);
          }
        } else if (verbose && event.type === "task_started") {
          agentLabels.set(event.agent_id, event.label || event.agent_id);
          printTaskStarted(event);
        } else if (verbose && event.type === "task_activity") {
          printTaskActivity(event);
        } else if (verbose && event.type === "task_completed") {
          printTaskCompleted(event, agentLabels.get(event.agent_id));
          agentLabels.delete(event.agent_id);
        } else if (verbose && event.type === "error") {
          console.log(`\x1b[31m❌ ${event.message}${RESET}`);
        }
      }
      if (verbose) {
        printedAgentCount = printNewAgentMessages(
          snapshot.messages,
          printedAgentCount,
        );
      }
    };
    if (verbose) {
      thinkingPrinted = true;
      console.log(`${DIM}⏳ Thinking…${RESET}`);
    }
    await session.sendAsync(message);
    const boundary = printBoundaryForTurn(
      session.getSnapshot().events,
      session.getSnapshot().messages,
      session.getSnapshot().turnId,
    );
    handledSequence = boundary.handledSequence;
    printedAgentCount = boundary.printedAgentCount;
    const unsubscribe = session.subscribe(render);
    render();
    await waitForTurnStop(session);
    render();
    unsubscribe();

    if (verbose) {
      console.log(`${DIM}✅ Done${RESET}`);
    }

    const newActions = session.actions
      .pending()
      .filter((action) => !previousActionIds.has(action.id));

    for (const action of newActions) {
      console.log(`⚡ Action awaiting response: ${action.id}`);
      if (action.request.type === "execute_evm") {
        console.log(
          `   EVM transactions: ${action.request.transactions.length}`,
        );
      } else if (action.request.type === "execute_svm") {
        console.log(
          `   SVM transactions: ${action.request.transactions.length}`,
        );
      } else {
        console.log(`   ${action.request.chainFamily.toUpperCase()} signature`);
        if (action.request.description) {
          console.log(`   ${action.request.description}`);
        }
      }
    }

    if (!verbose) {
      const agentMessages = session
        .getSnapshot()
        .messages.filter((entry) => entry.sender === "agent");
      const last = agentMessages[agentMessages.length - 1];

      if (last?.content) {
        console.log(last.content);
      } else if (session.getSnapshot().turnState === "interrupted") {
        console.log("(interrupted)");
      } else if (newActions.length === 0) {
        console.log("(no response)");
        fatal("Backend returned an empty agent message.");
      }
    }

    if (newActions.length > 0) {
      console.log(
        "\nRun `aomi tx list` to inspect Actions, `aomi tx sign <action-id>` to execute.",
      );
    }
  } finally {
    session.close();
  }
}
