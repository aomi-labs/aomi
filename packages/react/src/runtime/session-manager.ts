// =============================================================================
// SessionManager — manages one ClientSession per thread
// =============================================================================

import type { AomiClient } from "@aomi-labs/client";
import {
  Session as ClientSession,
  type SessionOptions,
} from "@aomi-labs/client";

export class SessionManager {
  private sessions = new Map<string, ClientSession>();

  constructor(private readonly clientFactory: () => AomiClient) {}

  getOrCreate(
    threadId: string,
    opts: Omit<SessionOptions, "sessionId">,
  ): ClientSession {
    let session = this.sessions.get(threadId);
    if (session) return session;

    session = new ClientSession(this.clientFactory(), {
      ...opts,
      sessionId: threadId,
    });
    this.sessions.set(threadId, session);
    return session;
  }

  get(threadId: string): ClientSession | undefined {
    return this.sessions.get(threadId);
  }

  get size(): number {
    return this.sessions.size;
  }

  forEach(callback: (session: ClientSession, threadId: string) => void): void {
    for (const [threadId, session] of this.sessions) {
      callback(session, threadId);
    }
  }

  close(threadId: string): void {
    const session = this.sessions.get(threadId);
    if (session) {
      session.close();
      this.sessions.delete(threadId);
    }
  }

  closeAll(): void {
    for (const [threadId, session] of this.sessions) {
      session.close();
    }
    this.sessions.clear();
  }
}
