import { AomiClient } from "../../client";
import { CliSession } from "../cli-session";
import { fatal } from "../errors";
import {
  RESET,
  YELLOW,
  countToolCalls,
  printDataFileLocation,
} from "../output";
import {
  deleteStoredSession,
  listStoredSessions,
  setActiveSession,
  type StoredSessionRecord,
} from "../state";
import { createCliAuthTokenProvider } from "../auth";
import { estimateTokenCount, printKeyValueTable } from "../tables";
import type { CliConfig } from "../types";

type RemoteSessionStats = {
  topic: string;
  messageCount: number;
  tokenCountEstimate: number;
  toolCalls: number;
  pendingActions: number;
};

async function fetchRemoteSessionStats(
  record: StoredSessionRecord,
): Promise<RemoteSessionStats | null> {
  const client = new AomiClient({
    baseUrl: record.state.baseUrl,
    apiKey: record.state.apiKey,
    getAccountBearer: createCliAuthTokenProvider(() => record.state),
  });

  try {
    const page = await client.agent.poll(record.sessionId);
    const messages = page.events.filter((event) => event.type === "message");
    const title = page.events.findLast(
      (event) => event.type === "title_changed",
    );
    return {
      topic:
        title?.type === "title_changed"
          ? (title.title ?? "Untitled Session")
          : "Untitled Session",
      messageCount: messages.length,
      tokenCountEstimate: estimateTokenCount(messages),
      toolCalls: countToolCalls(page.events),
      pendingActions: page.events.filter(
        (event) => event.type === "action" && event.state === "pending",
      ).length,
    };
  } catch {
    return null;
  }
}

function printSessionSummary(
  record: StoredSessionRecord,
  stats: RemoteSessionStats | null,
  isActive: boolean,
): void {
  const header = isActive
    ? `🧵 Session id: ${record.sessionId} (session-${record.localId}, active)`
    : `🧵 Session id: ${record.sessionId} (session-${record.localId})`;

  console.log(`${YELLOW}------ ${header} ------${RESET}`);
  printKeyValueTable([
    ["🧠 topic", stats?.topic ?? "Unavailable (fetch failed)"],
    ["💬 msg count", stats ? String(stats.messageCount) : "n/a"],
    [
      "🧮 token count",
      stats ? `${stats.tokenCountEstimate} (estimated)` : "n/a",
    ],
    ["🛠 tool calls", stats ? String(stats.toolCalls) : "n/a"],
    ["⚡ pending actions", stats ? String(stats.pendingActions) : "n/a"],
  ]);
}

export async function sessionsCommand(_config: CliConfig): Promise<void> {
  const sessions = listStoredSessions().sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
  if (sessions.length === 0) {
    console.log("No local sessions.");
    printDataFileLocation();
    return;
  }

  const activeSessionId = CliSession.load()?.sessionId;

  const statsResults = await Promise.all(
    sessions.map((record) => fetchRemoteSessionStats(record)),
  );

  for (let i = 0; i < sessions.length; i++) {
    printSessionSummary(
      sessions[i],
      statsResults[i],
      sessions[i].sessionId === activeSessionId,
    );
    if (i < sessions.length - 1) {
      console.log();
    }
  }

  printDataFileLocation();
}

export function newSessionCommand(config: CliConfig): void {
  const existing = CliSession.load();
  const cli = CliSession.create(config, existing?.toState());
  console.log(`Active session set to ${cli.sessionId} (new).`);
  printDataFileLocation();
}

export async function resumeSessionCommand(selector: string): Promise<void> {
  const resumed = setActiveSession(selector);
  if (resumed) {
    console.log(
      `Active session set to ${resumed.sessionId} (session-${resumed.localId}).`,
    );
    printDataFileLocation();
    return;
  }

  const current = CliSession.load();
  if (!current) {
    fatal(
      `No local session found for selector "${selector}" and no authenticated session is available to import it.`,
    );
  }

  const session = current.createClientSession();
  try {
    await session.client.agent.sessions.get(selector);
  } catch {
    fatal(
      `No account-owned local or remote session found for selector "${selector}".`,
    );
  } finally {
    session.close();
  }

  const imported = CliSession.create(
    { secrets: {} },
    current.toState(),
    selector,
  );
  console.log(
    `Active session set to ${imported.sessionId} (imported remote session).`,
  );
  printDataFileLocation();
}

export function deleteSessionCommand(selector: string): void {
  const deleted = deleteStoredSession(selector);
  if (!deleted) {
    fatal(`No local session found for selector "${selector}".`);
  }
  console.log(
    `Deleted local session ${deleted.sessionId} (session-${deleted.localId}).`,
  );
  const active = CliSession.load();
  if (active) {
    console.log(`Active session: ${active.sessionId}`);
  } else {
    console.log("No active session");
  }
  printDataFileLocation();
}
