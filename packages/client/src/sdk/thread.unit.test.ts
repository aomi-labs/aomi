import { describe, expect, it, vi } from "vitest";

import { Aomi } from "./aomi";
import type { CommitView, EventPage } from "../";

const at = Date.parse("2026-10-28T00:00:00Z");
const signer = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const meta = (sequence: number, turn = "turn-1") => ({
  event_id: `event-${sequence}`,
  sequence,
  turn_id: turn,
  occurred_at: at,
});

const commit = (id: string, extra: Partial<CommitView> = {}): CommitView => ({
  version: 1,
  commit_id: id,
  thread_id: "thread-1",
  stage_id: `evm:${id}`,
  chain_family: "evm",
  chain_ref: "8453",
  signer,
  broadcaster: "hosted",
  state: "needs_signature",
  transaction_id: null,
  failure_code: null,
  batch: null,
  review: null,
  wallet_attempt: null,
  action: null,
  ...extra,
});

/** One finished turn: an earlier turn's tool, two tools of this one (an
 * inline result and a typed completion), the answer, two commits. */
function finishedTurn(): EventPage {
  return {
    session_id: "thread-1",
    cursor: "c-6",
    has_more: false,
    started_turn_id: "turn-1",
    events: [
      {
        ...meta(1, "turn-0"),
        type: "tool_complete",
        id: "old",
        tool_name: "get_balance",
        result: {},
      },
      {
        ...meta(2),
        type: "message",
        sender: "agent",
        content: "",
        tool_call_id: "call-1",
        tool_name: "get_balance",
        tool_arguments: { chain_id: 8453 },
        tool_result: ["get_balance", '{"eth":"2.41"}'],
      },
      {
        ...meta(3),
        type: "tool_complete",
        id: "tool-2",
        call_id: "call-2",
        tool_name: "evm_commit_txs",
        result: { status: "pending_approval" },
      },
      {
        ...meta(4),
        type: "message",
        sender: "agent",
        content: "Swap is ready.",
        is_streaming: false,
      },
      { ...meta(5), type: "turn_state_changed", state: "complete" },
    ],
    commits: [
      commit("c-sign"),
      commit("c-done", { state: "confirmed" }),
      commit("c-park", { state: "awaiting_approval" }),
    ],
  } as EventPage;
}

function backend() {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (method === "POST" && url.pathname === "/v1/agent/chat")
      return Response.json(finishedTurn());
    const ref = url.pathname.match(/^\/v1\/commits\/(.+)$/)?.[1];
    if (ref)
      return Response.json({
        ...finishedTurn().commits!.find((view) => view.commit_id === ref),
        sign_url: `https://chat.example/sign/${ref}`,
      });
    if (url.pathname === "/v1/agent/sessions")
      return Response.json({
        sessions: [
          {
            id: "thread-1",
            title: "Base swaps",
            updatedAt: at,
            archived: false,
          },
        ],
        nextCursor: null,
      });
    if (method === "PATCH" && url.pathname === "/v1/agent/sessions/thread-1")
      return Response.json({
        id: "thread-1",
        title: JSON.parse(String(init?.body)).title,
        updatedAt: at,
        archived: false,
      });
    return Response.json({ error: "unexpected" }, { status: 500 });
  });
  return {
    fetch,
    aomi: new Aomi({ baseUrl: "https://chat.example", guest: false, fetch }),
  };
}

describe("aomi.agent threads and turns", () => {
  it("streams this turn's tool calls, then answers the reply and open commits", async () => {
    const { aomi } = backend();
    const turn = aomi.agent.thread("thread-1").send("Swap 0.1 ETH to USDC");

    const steps = [];
    for await (const step of turn.steps()) steps.push(step);
    expect(steps).toEqual([
      {
        id: "call-1",
        name: "get_balance",
        args: { chain_id: 8453 },
        result: { eth: "2.41" },
      },
      {
        id: "call-2",
        name: "evm_commit_txs",
        result: { status: "pending_approval" },
      },
    ]);

    const { reply, commits, threadId } = await turn;
    expect(reply).toBe("Swap is ready.");
    expect(threadId).toBe("thread-1");
    expect(commits.map((open) => [open.ref, open.state, open.kind])).toEqual([
      ["c-sign", "needs_signature", "evm_tx"],
      ["c-park", "awaiting_approval", "evm_tx"],
    ]);
    expect(commits[1]!.signUrl).toBe("https://chat.example/sign/c-park");
    for (const open of commits) open.close();
    await expect(turn.interrupt()).resolves.toBeUndefined();
  });

  it("decodes each step with the injected decoder", async () => {
    const { aomi } = backend();
    const turn = aomi.agent.thread("thread-1").send("hi");
    const titles: string[] = [];
    for await (const title of turn.steps({
      decode: (step, earlier) => `${earlier.length}:${step.name}`,
    }))
      titles.push(title);
    expect(titles).toEqual(["0:get_balance", "1:evm_commit_txs"]);
    for (const open of (await turn).commits) open.close();
  });

  it("starts a new thread with a fresh id and lists and renames threads", async () => {
    const { aomi, fetch } = backend();
    const thread = aomi.agent.thread();
    expect(thread.id).toMatch(/^[0-9a-f-]{36}$/);

    await expect(aomi.agent.threads.list({ limit: 10 })).resolves.toEqual({
      threads: [
        expect.objectContaining({ id: "thread-1", title: "Base swaps" }),
      ],
      nextCursor: undefined,
    });
    expect(String(fetch.mock.calls[0]![0])).toContain("limit=10");

    await expect(
      aomi.agent.thread("thread-1").rename("Base swaps 2"),
    ).resolves.toMatchObject({ title: "Base swaps 2" });
  });

  it("answers the reply from agent.run", async () => {
    const { aomi } = backend();
    const { reply } = await aomi.agent.run("ETH price?", {
      sessionId: "thread-1",
    });
    expect(reply).toBe("Swap is ready.");
  });
});
