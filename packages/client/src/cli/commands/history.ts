import { CliSession } from "../cli-session";
import {
  CYAN,
  DIM,
  RESET,
  YELLOW,
  countToolCalls,
  formatLogContent,
  printDataFileLocation,
} from "../output";
import { clearState } from "../state";
import { estimateTokenCount, printKeyValueTable } from "../tables";
import type { CliConfig } from "../types";

export async function logCommand(config: CliConfig): Promise<void> {
  const cli = CliSession.load();
  if (!cli) {
    console.log("No active session");
    printDataFileLocation();
    return;
  }
  cli.mergeConfig(config);

  const session = cli.createClientSession(config);
  try {
    await session.fetchCurrentState();
    const snapshot = session.getSnapshot();
    const messages = snapshot.messages;
    const actions = snapshot.actions;
    const toolCalls = countToolCalls(snapshot.events);
    const tokenCountEstimate = estimateTokenCount(messages);
    const topic = snapshot.title ?? "Untitled Session";

    if (messages.length === 0) {
      console.log("No messages in this session.");
      printDataFileLocation();
      return;
    }

    console.log(`------ Session id: ${cli.sessionId} ------`);
    printKeyValueTable([
      ["topic", topic],
      ["msg count", String(messages.length)],
      ["token count", `${tokenCountEstimate} (estimated)`],
      ["tool calls", String(toolCalls)],
      ["actions", String(actions.length)],
      ["pending actions", String(session.actions.pending().length)],
    ]);

    console.log("-------------------- Messages --------------------");
    for (const msg of messages) {
      const content = formatLogContent(msg.content);
      let time = "";
      if (msg.occurred_at) {
        const raw = msg.occurred_at;
        const date = new Date(raw < 1e12 ? raw * 1000 : raw);
        time = Number.isNaN(date.getTime())
          ? ""
          : `${DIM}${date.toLocaleTimeString()}${RESET} `;
      }

      const sender = msg.sender ?? "unknown";
      if (sender === "user") {
        if (content) {
          console.log(`${time}${CYAN}👤 You:${RESET} ${content}`);
        }
      } else if (sender === "agent") {
        if (content) {
          console.log(`${time}${CYAN}🤖 Agent:${RESET} ${content}`);
        }
      } else if (sender === "system") {
        if (content && !content.startsWith("Response of system endpoint:")) {
          console.log(`${time}${YELLOW}⚙️  System:${RESET} ${content}`);
        }
      } else {
        if (content) {
          console.log(`${time}${DIM}[${sender}]${RESET} ${content}`);
        }
      }
    }

    console.log(`\n${DIM}— ${messages.length} messages —${RESET}`);
    printDataFileLocation();
  } finally {
    session.close();
  }
}

export function closeCommand(config: CliConfig): void {
  const cli = CliSession.load();
  if (cli) {
    cli.mergeConfig(config);
    const session = cli.createClientSession(config);
    session.close();
  }
  clearState();
  console.log("Session closed");
}
