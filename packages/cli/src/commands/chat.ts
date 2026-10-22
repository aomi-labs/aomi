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
import type { SendOptions } from "@aomi-labs/client";
import type { Session as ClientSession } from "@aomi-labs/client";
import type { Event, MessageEvent } from "@aomi-labs/client";
import { AgentApiError, isTerminalCommit } from "@aomi-labs/client";

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

/** One session and renderer for the whole interactive conversation. */
export async function openInteractiveChat(config: CliConfig, verbose: boolean) {
  const cli = CliSession.loadOrCreate(config);
  const session = cli.createClientSession(config, {
    onPayment: printPaymentEvent,
  });
  await ingestSecretsForSession(config, cli, session.client);
  await applyRequestedModelIfPresent(config, cli, session);
  try {
    await session.fetchCurrentState();
  } catch (error) {
    if (
      !(
        error instanceof AgentApiError &&
        error.status === 404 &&
        error.code === "session_not_found"
      )
    ) {
      session.close();
      throw error;
    }
  }
  let printed = session
    .getSnapshot()
    .messages.filter((message) => message.sender === "agent").length;
  let sequence = session.getSnapshot().events.at(-1)?.sequence ?? 0;
  const statuses = new Map<string, string>();
  const unsubscribe = session.subscribe(() => {
    const snapshot = session.getSnapshot();
    for (const input of snapshot.inputs ?? []) {
      if (statuses.get(input.inputId) === input.status) continue;
      statuses.set(input.inputId, input.status);
      console.log(`[${input.operation}: ${input.status}] ${input.message}`);
    }
    for (const event of snapshot.events) {
      if (event.sequence <= sequence) continue;
      sequence = event.sequence;
      if (verbose && event.type === "tool_complete") printToolComplete(event);
      if (event.type === "error") console.error(event.message);
      if (event.type === "action" && event.state === "pending")
        console.log(`Approval required: ${event.id}`);
    }
    printed = printNewAgentMessages(snapshot.messages, printed);
  });
  const unobserve = session.observe();
  return {
    session,
    send: async (text: string) => {
      const snapshot = session.getSnapshot();
      const active = snapshot.control
        ? snapshot.control.active_turn_id
        : snapshot.turnState === "processing" ||
            snapshot.turnState === "awaiting_action"
          ? snapshot.turnId
          : undefined;
      if (active) await session.steer(text, { targetTurnId: active });
      else await session.sendAsync(text);
    },
    queue: async (text: string) => {
      await session.queue(text);
    },
    cancel: async (turnId?: string) => {
      if (turnId) await session.cancel({ targetTurnId: turnId });
      else await session.interrupt();
    },
    sync: () =>
      CliSession.loadOrCreate({
        ...config,
        freshSession: false,
      }).syncClientSession(session, config),
    close: () => {
      unsubscribe();
      unobserve();
      session.close();
    },
  };
}

export async function turnInputCommand(
  config: CliConfig,
  message: string,
  options: {
    intent: "steer" | "queue";
    inputId: string;
    targetTurnId?: string;
    expectedInputRevision?: number;
  },
): Promise<void> {
  const cli = CliSession.loadOrCreate(config);
  const session = cli.createClientSession(config, {
    onPayment: printPaymentEvent,
  });
  try {
    await ingestSecretsForSession(config, cli, session.client);
    await session.fetchCurrentState();
    const page =
      options.intent === "steer"
        ? await session.steer(message, options)
        : await session.queue(message, { inputId: options.inputId });
    console.log(
      JSON.stringify({
        sessionId: cli.sessionId,
        input: page.input,
        control: page.control,
      }),
    );
  } finally {
    session.close();
  }
}

export async function chatCommand(
  config: CliConfig,
  message: string,
  verbose: boolean,
  branch: SendOptions = {},
): Promise<void> {
  if (!message && !branch.regenerate) {
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
    const previousCommitIds = new Set(
      session.commits.all().map((commit) => commit.commit_id),
    );
    let printedAgentCount = 0;
    let handledSequence = 0;
    let thinkingPrinted = false;
    const agentLabels = new Map<string, string>();
    // One printed line per (turn, tool) pair, whichever wire shape lands
    // first. Suppressing by turn alone silently drops a distinct tool's only
    // trace whenever another tool in the turn used the other shape.
    const seenToolPairs = new Set<string>();
    const toolPairKey = (turnId: string, name: string) => `${turnId}::${name}`;
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
    if (branch.edit && branch.regenerate) fatal("Choose --edit or --rerun.");
    await session.sendAsync(message, branch);
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
    const newCommits = session.commits
      .all()
      .filter(
        (commit) =>
          !previousCommitIds.has(commit.commit_id) && !isTerminalCommit(commit),
      );

    for (const commit of newCommits) {
      console.log(
        `🔐 Commit awaiting ${commit.action?.kind ?? "confirmation"}: ${commit.commit_id} (${commit.chain_family.toUpperCase()}, ${commit.state})`,
      );
    }

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
      } else if (newActions.length === 0 && newCommits.length === 0) {
        console.log("(no response)");
        fatal("Backend returned an empty agent message.");
      }
    }

    if (newActions.length > 0 || newCommits.length > 0) {
      console.log(
        "\nRun `aomi tx list` to inspect commits and Actions, then `aomi tx sign <id>` or `aomi tx reject <id>`.",
      );
      if (newCommits.length > 0) {
        console.log(
          "For an external signer, export one exact review with `aomi tx export <id> --format commit`.",
        );
      }
    }
  } finally {
    session.close();
  }
}
