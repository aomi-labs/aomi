import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AomiClient,
  Session,
  AgentApiError,
  type Event,
  type EventPage,
  type InputReceipt,
} from "./";

const sessions: Session[] = [];
afterEach(() => {
  for (const session of sessions.splice(0)) session.close();
  vi.useRealTimers();
});
function control(
  revision = 1,
  active: string | null = "turn-1",
  sequence = revision,
) {
  return {
    active_turn_id: active,
    accepted_input_revision: revision,
    applied_input_revision: Math.max(1, revision - 1),
    queued_turn_ids: [],
    event_sequence: sequence,
    stream_epoch: "epoch-1",
  };
}
function page(extra: Partial<EventPage> = {}): EventPage {
  return {
    session_id: "steering-session",
    cursor: "cursor-1",
    events: [],
    has_more: false,
    capabilities: { turn_input: 1 },
    control: control(),
    ...extra,
  };
}
function receipt(
  id: string,
  revision: number,
  disposition: InputReceipt["disposition"] = "accepted",
): InputReceipt {
  return {
    input_id: id,
    turn_id: "turn-1",
    operation: "steer",
    disposition,
    input_revision: revision,
    received_at: 1,
    admitted_at: 1,
    applied_at: disposition === "applied" ? 2 : null,
  };
}
function state(
  sequence: number,
  turn_id: string,
  value: "processing" | "complete",
): Event {
  return {
    type: "turn_state_changed",
    event_id: `event-${sequence}`,
    sequence,
    occurred_at: sequence,
    turn_id,
    state: value,
  };
}
function answer(sequence: number, turn_id: string): Event {
  return {
    type: "message",
    event_id: `event-${sequence}`,
    sequence,
    occurred_at: sequence,
    turn_id,
    sender: "agent",
    content: `${turn_id} answer`,
    message_key: `${turn_id}:response`,
    is_streaming: false,
  };
}
async function setup() {
  const client = new AomiClient({
    baseUrl: "https://example.test",
    fetch: vi.fn(),
  });
  const frames: Array<Parameters<typeof client.agent.stream>[2]> = [];
  vi.spyOn(client.agent, "stream").mockImplementation(
    async (_id, options, frame) => {
      frames.push(frame);
      await new Promise<void>((resolve) =>
        options.signal.addEventListener("abort", () => resolve(), {
          once: true,
        }),
      );
    },
  );
  const poll = vi
    .spyOn(client.agent, "poll")
    .mockResolvedValue(page({ events: [state(1, "turn-1", "processing")] }));
  const start = vi.spyOn(client.agent, "start");
  const steer = vi.spyOn(client.agent, "steer");
  const session = new Session(client, { sessionId: "steering-session" });
  sessions.push(session);
  await session.sync();
  return { session, client, poll, start, steer, frames };
}

describe("shared turn input admission", () => {
  it("serializes rapid corrections by their own acknowledgements without waiting for completion", async () => {
    const { session, steer, start } = await setup();
    let resolveFirst!: (value: EventPage) => void;
    steer.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    );
    steer.mockResolvedValueOnce(
      page({ input: receipt("second", 3), control: control(3) }),
    );
    const first = session.steer("Use 5 instead", { inputId: "first" });
    const second = session.steer("Use Base", { inputId: "second" });
    await Promise.resolve();
    expect(steer).toHaveBeenCalledTimes(1);
    resolveFirst(page({ input: receipt("first", 2), control: control(2) }));
    await Promise.all([first, second]);
    expect(
      steer.mock.calls.map((call) => call[1].expectedInputRevision),
    ).toEqual([1, 2]);
    expect(steer.mock.calls.map((call) => call[1].turnId)).toEqual([
      "turn-1",
      "turn-1",
    ]);
    expect(start).not.toHaveBeenCalled();
  });

  it("replays a lost acknowledgement with the exact original identity and revision", async () => {
    const { session, steer, poll } = await setup();
    steer.mockRejectedValueOnce(new TypeError("Response lost"));
    await expect(session.steer("Use 5", { inputId: "lost" })).rejects.toThrow(
      "Response lost",
    );
    poll.mockResolvedValueOnce(page({ control: control(2) }));
    await session.sync();
    steer.mockResolvedValueOnce(
      page({ input: receipt("lost", 2), control: control(2) }),
    );
    await session.steer("Use 5");
    expect(steer.mock.calls[1]).toEqual(steer.mock.calls[0]);
    expect(session.getSnapshot().inputs).toHaveLength(1);
  });

  it("keeps a completed target bound and never converts rejection into a new send", async () => {
    const { session, steer, start } = await setup();
    steer.mockRejectedValueOnce(
      new AgentApiError(409, "target_terminal", "Request finished", false),
    );
    await expect(
      session.steer("Use 5", {
        targetTurnId: "turn-1",
        expectedInputRevision: 1,
        inputId: "late",
      }),
    ).rejects.toMatchObject({ code: "target_terminal" });
    expect(session.getSnapshot().inputs?.[0]).toMatchObject({
      message: "Use 5",
      targetTurnId: "turn-1",
      status: "rejected",
    });
    expect(start).not.toHaveBeenCalled();
  });

  it.each(["applied", "cancelled", "superseded"] as const)(
    "does not regress a %s input or control state on an older admission replay",
    async (disposition) => {
      const { session, steer, poll } = await setup();
      steer.mockResolvedValueOnce(
        page({ input: receipt("update", 2, disposition), control: control(3) }),
      );
      await session.steer("Use 5", { inputId: "update" });
      poll.mockResolvedValueOnce(
        page({ input: receipt("update", 2), control: control(2) }),
      );
      await session.sync();
      expect(session.getSnapshot().inputs?.[0]?.status).toBe(disposition);
      expect(session.getSnapshot().control?.accepted_input_revision).toBe(3);
    },
  );

  it("fails explicitly on a host without steering capabilities", async () => {
    const { session, steer, start, poll } = await setup();
    poll.mockResolvedValueOnce(page({ capabilities: { turn_input: 0 } }));
    await session.sync();
    await expect(session.steer("Use 5")).rejects.toMatchObject({
      code: "steering_unsupported",
    });
    await expect(session.queue("Other task")).rejects.toMatchObject({
      code: "steering_unsupported",
    });
    expect(steer).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it("settles T1 with T1's answer while an observed conversation follows T2", async () => {
    vi.useFakeTimers();
    const { session, start, frames } = await setup();
    const release = session.observe();
    start.mockResolvedValueOnce(page({ started_turn_id: "turn-1" }));
    // The initial sync represented an existing active turn; use another fresh
    // session for the send waiter while retaining the same controlled transport.
    session.close();
    const second = new Session(session.client, {
      sessionId: "steering-session",
    });
    sessions.push(second);
    const unobserve = second.observe();
    const sent = second.send("Explain");
    await vi.advanceTimersByTimeAsync(0);
    frames.at(-1)!(
      "page",
      page({
        events: [
          answer(2, "turn-1"),
          state(3, "turn-1", "complete"),
          state(4, "turn-2", "processing"),
        ],
        control: control(1, "turn-2", 4),
      }),
    );
    const result = await sent;
    expect(result.messages.map((message) => message.turn_id)).toEqual([
      "turn-1",
    ]);
    expect(second.getSnapshot()).toMatchObject({
      turnId: "turn-2",
      turnState: "processing",
      isStreaming: true,
    });
    release();
    unobserve();
  });
});
