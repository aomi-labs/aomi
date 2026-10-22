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

  it("lets a separate correction reach the host after a rejected predecessor without rebasing its captured revision", async () => {
    const { session, steer } = await setup();
    let rejectFirst!: (error: unknown) => void;
    steer.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectFirst = reject;
      }),
    );
    const conflict = () =>
      new AgentApiError(
        409,
        "revision_conflict",
        "Another client updated this request",
        false,
        undefined,
        {
          session_id: session.sessionId,
          control: control(2),
        },
      );
    steer.mockRejectedValueOnce(conflict());
    const first = session.steer("First correction", { inputId: "first" });
    const second = session.steer("Separate correction", { inputId: "second" });
    const firstRejected = expect(first).rejects.toMatchObject({
      code: "revision_conflict",
    });
    const secondRejected = expect(second).rejects.toMatchObject({
      code: "revision_conflict",
    });
    await Promise.resolve();
    rejectFirst(conflict());
    await Promise.all([firstRejected, secondRejected]);
    expect(
      steer.mock.calls.map((call) => [call[2], call[1].expectedInputRevision]),
    ).toEqual([
      ["first", 1],
      ["second", 1],
    ]);
    expect(session.getSnapshot().control?.accepted_input_revision).toBe(2);

    steer.mockResolvedValueOnce(
      page({ input: receipt("later", 3), control: control(3) }),
    );
    await session.steer("Later correction", { inputId: "later" });
    expect(steer.mock.calls[2]?.[1].expectedInputRevision).toBe(2);
    steer.mockRejectedValueOnce(conflict());
    await expect(session.retryInput("second")).rejects.toMatchObject({
      code: "revision_conflict",
    });
    expect(steer.mock.calls[3]).toEqual(steer.mock.calls[1]);
  });

  it("gates distinct corrections behind an unknown receipt until that exact input is resolved", async () => {
    const { session, steer } = await setup();
    steer.mockRejectedValueOnce(new TypeError("Acknowledgement lost"));
    const first = session.steer("First correction", { inputId: "unknown" });
    const second = session.steer("Separate correction", { inputId: "waiting" });
    const secondBlocked = expect(second).rejects.toMatchObject({
      code: "input_predecessor_unresolved",
    });
    await expect(first).rejects.toThrow("Acknowledgement lost");
    await secondBlocked;
    await expect(
      session.steer("Later separate correction", { inputId: "later" }),
    ).rejects.toMatchObject({ code: "input_predecessor_unresolved" });
    expect(steer).toHaveBeenCalledTimes(1);
    expect(
      session.getSnapshot().inputs?.find((input) => input.inputId === "unknown")
        ?.status,
    ).toBe("uncertain");

    steer.mockResolvedValueOnce(
      page({ input: receipt("unknown", 2), control: control(2) }),
    );
    await session.retryInput("unknown");
    expect(steer.mock.calls[1]).toEqual(steer.mock.calls[0]);
    steer.mockResolvedValueOnce(
      page({ input: receipt("waiting", 3), control: control(3) }),
    );
    await session.retryInput("waiting");
    expect(steer.mock.calls[2]?.[1]).toMatchObject({
      turnId: "turn-1",
      expectedInputRevision: 2,
      message: "Separate correction",
    });
    expect(steer.mock.calls[2]?.[2]).toBe("waiting");
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

  it.each([
    { control: control(2) },
    { session_id: "foreign-session", control: control(2) },
    {
      session_id: "steering-session",
      control: { ...control(2), stream_epoch: "other-epoch" },
    },
    { session_id: "steering-session", control: control(2, "turn-1", 0) },
    {
      session_id: "steering-session",
      control: { ...control(2), accepted_input_revision: 0 },
    },
    {
      session_id: "steering-session",
      control: { ...control(2), applied_input_revision: 3 },
    },
    {
      session_id: "steering-session",
      control: { ...control(2), accepted_input_revision: 2.5 },
    },
    {
      session_id: "steering-session",
      control: { ...control(2), queued_turn_ids: ["queued", "queued"] },
    },
  ])(
    "ignores unbound, stale, or malformed rejection control: %j",
    async (details) => {
      const { session, steer } = await setup();
      const before = session.getSnapshot().control;
      steer.mockRejectedValueOnce(
        new AgentApiError(
          409,
          "revision_conflict",
          "Stale revision",
          false,
          undefined,
          details,
        ),
      );
      await expect(
        session.steer("Retain this draft", { inputId: "rejected" }),
      ).rejects.toMatchObject({ code: "revision_conflict" });
      expect(session.getSnapshot().control).toEqual(before);
      expect(session.getSnapshot().inputs?.[0]).toMatchObject({
        inputId: "rejected",
        message: "Retain this draft",
        targetTurnId: "turn-1",
        status: "rejected",
      });
      expect(steer).toHaveBeenCalledTimes(1);
    },
  );

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

  it.each(["turn-1", "queued-turn"])(
    "can cancel existing %s work after new input admissions are disabled",
    async (targetTurnId) => {
      const { session, client, poll } = await setup();
      const current = { ...control(), queued_turn_ids: ["queued-turn"] };
      poll.mockResolvedValueOnce(
        page({ capabilities: { turn_input: 0 }, control: current }),
      );
      await session.sync();
      const cancelled = page({
        capabilities: { turn_input: 0 },
        terminal_turn: { turn_id: targetTurnId, state: "interrupted" },
        control: {
          ...control(1, targetTurnId === "turn-1" ? null : "turn-1", 2),
          queued_turn_ids: targetTurnId === "turn-1" ? ["queued-turn"] : [],
        },
      });
      const interrupt = vi
        .spyOn(client.agent, "interrupt")
        .mockResolvedValueOnce(cancelled);
      await expect(
        session.cancel({ targetTurnId, inputId: "drain-cancel" }),
      ).resolves.toEqual(cancelled);
      expect(interrupt).toHaveBeenCalledOnce();
      expect(interrupt).toHaveBeenCalledWith(
        session.sessionId,
        targetTurnId,
        "drain-cancel",
      );
    },
  );

  it("replays only a known exact input after admission capability switches off", async () => {
    const { session, steer, start, poll } = await setup();
    steer.mockRejectedValueOnce(new TypeError("Lost acknowledgement"));
    await expect(
      session.steer("Keep this exact correction", {
        inputId: "draining-input",
      }),
    ).rejects.toThrow("Lost acknowledgement");
    const original = steer.mock.calls[0];
    poll.mockResolvedValueOnce(page({ capabilities: { turn_input: 0 } }));
    await session.sync();
    steer.mockResolvedValueOnce(
      page({
        capabilities: { turn_input: 0 },
        input: receipt("draining-input", 2),
        control: control(2),
      }),
    );
    await session.retryInput("draining-input");
    expect(steer.mock.calls[1]).toEqual(original);
    expect(session.getSnapshot().inputs?.[0]).toMatchObject({
      inputId: "draining-input",
      status: "accepted",
    });
    await expect(session.retryInput("unknown-input")).rejects.toThrow(
      "Unknown input identity",
    );
    await expect(session.steer("A new correction")).rejects.toMatchObject({
      code: "steering_unsupported",
    });
    await expect(session.queue("New independent work")).rejects.toMatchObject({
      code: "steering_unsupported",
    });
    expect(steer).toHaveBeenCalledTimes(2);
    expect(start).not.toHaveBeenCalled();
  });

  it("keeps guest ownership and closed-session guards on draining operations", async () => {
    const { session, client, steer, poll } = await setup();
    const guest = vi.spyOn(client, "guestIdentity").mockReturnValue("guest-1");
    await session.sync();
    steer.mockRejectedValueOnce(new TypeError("Lost acknowledgement"));
    await expect(
      session.steer("Retained correction", { inputId: "known" }),
    ).rejects.toThrow("Lost acknowledgement");
    poll.mockResolvedValueOnce(page({ capabilities: { turn_input: 0 } }));
    await session.sync();
    const interrupt = vi.spyOn(client.agent, "interrupt");
    guest.mockReturnValue("guest-2");
    await expect(
      session.cancel({ targetTurnId: "turn-1" }),
    ).rejects.toMatchObject({
      code: "guest_identity_changed",
      isGuestIdentityChanged: true,
    });
    await expect(session.retryInput("known")).rejects.toMatchObject({
      code: "guest_identity_changed",
      isGuestIdentityChanged: true,
    });
    session.close();
    await expect(session.cancel({ targetTurnId: "turn-1" })).rejects.toThrow(
      "Session is closed",
    );
    await expect(session.retryInput("known")).rejects.toThrow(
      "Session is closed",
    );
    expect(interrupt).not.toHaveBeenCalled();
    expect(steer).toHaveBeenCalledOnce();
  });

  it("replays a retained queue admission exactly while new queue admissions are disabled", async () => {
    const { session, start, poll } = await setup();
    start.mockRejectedValueOnce(new TypeError("Lost queue acknowledgement"));
    await expect(
      session.queue("Independent request", { inputId: "draining-queue" }),
    ).rejects.toThrow("Lost queue acknowledgement");
    const original = start.mock.calls[0];
    poll.mockResolvedValueOnce(page({ capabilities: { turn_input: 0 } }));
    await session.sync();
    start.mockResolvedValueOnce(
      page({
        capabilities: { turn_input: 0 },
        input: {
          ...receipt("draining-queue", 1, "queued"),
          operation: "queue",
          turn_id: "queued-turn",
        },
        control: { ...control(), queued_turn_ids: ["queued-turn"] },
      }),
    );
    await session.retryInput("draining-queue");
    expect(start.mock.calls[1]).toEqual(original);
    expect(session.getSnapshot().control?.queued_turn_ids).toEqual([
      "queued-turn",
    ]);
    await expect(session.queue("Different request")).rejects.toMatchObject({
      code: "steering_unsupported",
    });
    expect(start).toHaveBeenCalledTimes(2);
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
