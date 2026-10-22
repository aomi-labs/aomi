import { isTerminalCommit, type Session } from "@aomi-labs/client";
import { fatal } from "./errors";
import {
  DIM,
  RESET,
  YELLOW,
  getToolNameFromEvent,
  inlineToolResultFromMessage,
  isAlwaysVisibleTool,
  printNewAgentMessages,
  printTaskActivity,
  printTaskCompleted,
  printTaskStarted,
  printToolComplete,
  printToolResultLine,
} from "./output";

type PrintBoundary = { handledSequence: number; printedAgentCount: number };

/** Presentation state belongs to one live session, independent of its input loop. */
export function createSessionRenderer(
  session: Session,
  verbose: boolean,
  mode: "interactive" | "one-shot",
) {
  const initial = session.getSnapshot();
  let handledSequence = initial.events.at(-1)?.sequence ?? 0;
  let printedAgentCount = initial.messages.filter(
    (message) => message.sender === "agent",
  ).length;
  let thinkingPrinted = false;
  const agentLabels = new Map<string, string>();
  const seenToolPairs = new Set<string>();
  const statuses = new Map<string, string>();
  const seenActions = new Map(
    session.actions.all().map((action) => [action.id, action.revision]),
  );
  const seenCommits = new Map(
    session.commits.all().map((commit) => [commit.commit_id, commit.version]),
  );
  const begin = () => {
    if (!verbose || thinkingPrinted) return;
    thinkingPrinted = true;
    console.log(`${DIM}⏳ Thinking…${RESET}`);
  };
  const printPending = () => {
    const actions = session.actions
      .pending()
      .filter((action) => seenActions.get(action.id) !== action.revision);
    const commits = session.commits
      .all()
      .filter(
        (commit) =>
          seenCommits.get(commit.commit_id) !== commit.version &&
          !isTerminalCommit(commit),
      );
    for (const commit of commits) {
      seenCommits.set(commit.commit_id, commit.version);
      console.log(
        `🔐 Commit awaiting ${commit.action?.kind ?? "confirmation"}: ${commit.commit_id} (${commit.chain_family.toUpperCase()}, ${commit.state})`,
      );
    }
    for (const action of actions) {
      seenActions.set(action.id, action.revision);
      console.log(`⚡ Action awaiting response: ${action.id}`);
      if (action.request.type === "execute_evm")
        console.log(
          `   EVM transactions: ${action.request.transactions.length}`,
        );
      else if (action.request.type === "execute_svm")
        console.log(
          `   SVM transactions: ${action.request.transactions.length}`,
        );
      else {
        console.log(`   ${action.request.chainFamily.toUpperCase()} signature`);
        if (action.request.description)
          console.log(`   ${action.request.description}`);
      }
    }
    return { actions, commits };
  };
  const instructions = (hasCommits: boolean) => {
    console.log(
      "\nRun `aomi tx list` to inspect commits and Actions, then `aomi tx sign <id>` or `aomi tx reject <id>`.",
    );
    if (hasCommits)
      console.log(
        "For an external signer, export one exact review with `aomi tx export <id> --format commit`.",
      );
  };
  return {
    begin,
    setBoundary: (boundary: PrintBoundary) => {
      handledSequence = boundary.handledSequence;
      printedAgentCount = boundary.printedAgentCount;
    },
    render: () => {
      const snapshot = session.getSnapshot();
      if (snapshot.isSubmitting || snapshot.turnState === "processing") begin();
      if (mode === "interactive")
        for (const input of snapshot.inputs ?? []) {
          if (statuses.get(input.inputId) === input.status) continue;
          statuses.set(input.inputId, input.status);
          console.log(`[${input.operation}: ${input.status}] ${input.message}`);
        }
      for (const event of snapshot.events) {
        if (event.sequence <= handledSequence) continue;
        handledSequence = event.sequence;
        if (event.type === "tool_complete") {
          const name = getToolNameFromEvent(event);
          if (name === "task") continue;
          const pair = `${event.turn_id ?? `event:${event.event_id}`}::${name}`;
          const first = !seenToolPairs.has(pair);
          seenToolPairs.add(pair);
          if (first && (verbose || isAlwaysVisibleTool(name)))
            printToolComplete(event);
        } else if (event.type === "message") {
          const tool = inlineToolResultFromMessage(event);
          if (tool) {
            const pair = `${tool.turnId}::${tool.name}`;
            const first = !seenToolPairs.has(pair);
            seenToolPairs.add(pair);
            if (first && (verbose || isAlwaysVisibleTool(tool.name)))
              printToolResultLine(tool.name, tool.result);
          } else if (verbose && event.sender === "notice")
            console.log(`${YELLOW}📢 ${event.content}${RESET}`);
        } else if (verbose && event.type === "task_started") {
          agentLabels.set(event.agent_id, event.label || event.agent_id);
          printTaskStarted(event);
        } else if (verbose && event.type === "task_activity")
          printTaskActivity(event);
        else if (verbose && event.type === "task_completed") {
          printTaskCompleted(event, agentLabels.get(event.agent_id));
          agentLabels.delete(event.agent_id);
        } else if (event.type === "error") {
          if (mode === "interactive") console.error(event.message);
          else if (verbose) console.log(`\x1b[31m❌ ${event.message}${RESET}`);
        }
      }
      if (verbose || mode === "interactive")
        printedAgentCount = printNewAgentMessages(
          snapshot.messages,
          printedAgentCount,
        );
      if (mode === "interactive") {
        const { actions, commits } = printPending();
        if (actions.length || commits.length) instructions(commits.length > 0);
      }
    },
    finish: () => {
      if (verbose) console.log(`${DIM}✅ Done${RESET}`);
      const { actions, commits } = printPending();
      if (!verbose) {
        const snapshot = session.getSnapshot();
        const last = snapshot.messages.findLast(
          (message) => message.sender === "agent",
        );
        if (last?.content) console.log(last.content);
        else if (snapshot.turnState === "interrupted")
          console.log("(interrupted)");
        else if (!actions.length && !commits.length) {
          console.log("(no response)");
          fatal("Backend returned an empty agent message.");
        }
      }
      if (actions.length || commits.length) instructions(commits.length > 0);
    },
  };
}
