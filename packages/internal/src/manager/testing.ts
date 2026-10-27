// A manager client over a fake fetch, for tests: every request is recorded,
// and each answer is the next queued body (the last one repeats).
import { vi } from "vitest";

import { ManagerClient } from "./client";

export type Sent = {
  method: string;
  /** The path and query, without the origin. */
  url: string;
  body: unknown;
  headers: Record<string, string>;
};

export function fakeManager(...answers: unknown[]) {
  const sent: Sent[] = [];
  const fetch = vi.fn(async (input: Request | string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    sent.push({
      method: init?.method ?? "GET",
      url: url.pathname + url.search,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const answer = answers.length > 1 ? answers.shift() : answers[0];
    return answer instanceof Response ? answer : Response.json(answer ?? {});
  });
  const client = new ManagerClient({ url: "https://manager.test/", bearer: "service-token", fetch });
  return { client, sent, fetch };
}
