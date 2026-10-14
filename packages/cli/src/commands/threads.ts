import { CliSession } from "../cli-session";
import { listStoredSessions } from "../state";
import { printJson } from "../output";
import type { CliConfig } from "../types";

export function remoteThreadId(selector: string): string {
  const local = listStoredSessions().find(
    (record) =>
      record.sessionId === selector || `session-${record.localId}` === selector,
  );
  return local?.sessionId ?? selector;
}

export async function threadsCommand(config: CliConfig): Promise<void> {
  const cli = CliSession.loadOrCreate(config);
  const session = cli.createClientSession(config);
  try {
    const threads = await session.client.agent.sessions.all();
    if (config.json) printJson(threads);
    else
      for (const thread of threads)
        console.log(
          `${thread.id}\t${thread.archived ? "archived" : "active"}\t${thread.title || "Untitled chat"}`,
        );
  } finally {
    session.close();
  }
}

export async function updateThreadCommand(
  config: CliConfig,
  selector: string,
  patch: { title?: string; archived?: boolean },
): Promise<void> {
  const cli = CliSession.loadOrCreate(config);
  const session = cli.createClientSession(config);
  try {
    const thread = await session.client.agent.sessions.update(
      remoteThreadId(selector),
      patch,
    );
    if (config.json) printJson(thread);
    else
      console.log(
        `${thread.id}\t${thread.archived ? "archived" : "active"}\t${thread.title || "Untitled chat"}`,
      );
  } finally {
    session.close();
  }
}
