import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AomiClient,
  Session,
  type Event,
  type MessageEvent,
  type SessionSnapshot,
} from "@aomi-labs/client";
import { createSessionRenderer } from "./session-renderer";

afterEach(() => vi.restoreAllMocks());
const meta = (sequence: number) => ({
  event_id: `event-${sequence}`,
  sequence,
  occurred_at: sequence,
  turn_id: "turn-1",
});
const message = (sequence: number, content: string): MessageEvent => ({
  ...meta(sequence),
  type: "message",
  sender: "agent",
  content,
  message_key: `message-${sequence}`,
});
function fixture(mode: "interactive" | "one-shot", verbose = true) {
  const session = new Session(
    new AomiClient({ baseUrl: "https://renderer.invalid", guest: false }),
    { sessionId: "render-thread" },
  );
  let snapshot = session.getSnapshot();
  vi.spyOn(session, "getSnapshot").mockImplementation(() => snapshot);
  vi.spyOn(session.actions, "all").mockImplementation(() => [
    ...snapshot.actions,
  ]);
  vi.spyOn(session.actions, "pending").mockImplementation(() =>
    snapshot.actions.filter((action) => action.state === "pending"),
  );
  vi.spyOn(session.commits, "all").mockImplementation(() => [
    ...snapshot.commits,
  ]);
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const renderer = createSessionRenderer(session, verbose, mode);
  return {
    renderer,
    log,
    errors,
    update: (patch: Partial<SessionSnapshot>) => {
      snapshot = { ...snapshot, ...patch };
    },
    text: () => log.mock.calls.flat().join("\n"),
  };
}

describe("shared CLI session rendering", () => {
  it.each(["interactive", "one-shot"] as const)(
    "renders rich %s traces once across repeated snapshots",
    (mode) => {
      const h = fixture(mode);
      const inline: MessageEvent = {
        ...message(1, ""),
        tool_name: "balance",
        tool_result: ["balance", "1 ETH"],
      };
      const answer = message(7, "Research complete");
      const events: Event[] = [
        inline,
        {
          ...meta(2),
          type: "tool_complete",
          id: "balance",
          tool_name: "balance",
          result: "1 ETH",
        },
        {
          ...meta(3),
          type: "task_started",
          call_id: "call",
          agent_id: "child",
          app: "research",
          label: "Analyst",
          resumed: false,
        },
        {
          ...meta(4),
          type: "task_activity",
          call_id: "call",
          agent_id: "child",
          child_seq: 1,
          kind: "note",
          text: "Reading prices",
        },
        {
          ...meta(5),
          type: "task_completed",
          call_id: "call",
          agent_id: "child",
          status: "completed",
          message: "Done",
          staged_count: 0,
          steps: 2,
          duration_ms: 1500,
        },
        { ...message(6, "Provider notice"), sender: "notice" },
        answer,
      ];
      h.update({ events, messages: [inline, answer], turnState: "complete" });
      h.renderer.render();
      h.renderer.render();
      const output = h.text();
      expect(output.match(/\[tool\] balance/g)).toHaveLength(1);
      expect(output.match(/Analyst started/g)).toHaveLength(1);
      expect(output).toContain("Reading prices");
      expect(output).toContain("Analyst: completed (2 steps, 1.5s)");
      expect(output.match(/Provider notice/g)).toHaveLength(1);
      expect(output.match(/Research complete/g)).toHaveLength(1);
    },
  );

  it("renders interactive receipt transitions and rich pending reviews without duplicating them", () => {
    const h = fixture("interactive", false);
    h.update({
      inputs: [
        {
          inputId: "update",
          operation: "steer",
          message: "Use Base",
          targetTurnId: "turn-1",
          status: "accepted",
        },
      ],
      actions: [
        {
          ...meta(1),
          type: "action",
          id: "signature",
          revision: 1,
          state: "pending",
          created_at: 1,
          expires_at: null,
          request: {
            type: "sign",
            requestId: "signature",
            chainFamily: "evm",
            executionKind: "eoa",
            signer: "0x1",
            description: "Review transfer",
            payloads: [],
          },
        },
      ],
      commits: [
        {
          version: 1,
          commit_id: "commit",
          thread_id: "render-thread",
          stage_id: "stage",
          chain_family: "evm",
          chain_ref: "8453",
          signer: "0x1",
          broadcaster: "wallet",
          state: "needs_signature",
          transaction_id: null,
          failure_code: null,
          batch: null,
          review: null,
          wallet_attempt: null,
          action: null,
        },
      ],
    });
    h.renderer.render();
    h.renderer.render();
    expect(h.text().match(/\[steer: accepted\]/g)).toHaveLength(1);
    expect(h.text().match(/Action awaiting response: signature/g)).toHaveLength(
      1,
    );
    expect(h.text()).toContain("EVM signature");
    expect(h.text()).toContain("Review transfer");
    expect(
      h.text().match(/Commit awaiting confirmation: commit/g),
    ).toHaveLength(1);
    h.update({
      inputs: [
        {
          inputId: "update",
          operation: "steer",
          message: "Use Base",
          targetTurnId: "turn-1",
          status: "applied",
        },
      ],
    });
    h.renderer.render();
    expect(h.text().match(/\[steer: applied\]/g)).toHaveLength(1);
  });

  it("keeps quiet one-shot output to the final response and skips prior turn history", () => {
    const h = fixture("one-shot", false);
    h.update({
      events: [message(1, "Old answer"), message(2, "Final answer")],
      messages: [message(1, "Old answer"), message(2, "Final answer")],
      turnState: "complete",
    });
    h.renderer.setBoundary({ handledSequence: 1, printedAgentCount: 1 });
    h.renderer.render();
    h.renderer.finish();
    expect(h.log.mock.calls).toEqual([["Final answer"]]);
  });
});
