import { describe, expect, it, vi } from "vitest";
import {
  AgentApiError,
  AomiClient,
  Session,
  type Event,
  type EventPage,
  type SendOptions,
} from "../src";

const sessionId = "conversation-intent-session";
const originalText = "Explain the first request";
const revisedText = "Explain the revised request";

function page(events: Event[]): EventPage {
  return {
    session_id: sessionId,
    cursor: `cursor-${events.at(-1)?.sequence ?? 0}`,
    events,
    has_more: false,
  };
}

function meta(sequence: number, turnId = "original-turn") {
  return {
    event_id: `event-${sequence}`,
    sequence,
    turn_id: turnId,
    occurred_at: sequence,
  };
}

const history: Event[] = [
  {
    ...meta(1),
    type: "message",
    sender: "user",
    content: originalText,
    message_key: "original-request",
  },
  {
    ...meta(2),
    type: "message",
    sender: "agent",
    content: "Original answer",
    message_key: "original-answer",
    is_streaming: false,
  },
  { ...meta(3), type: "turn_state_changed", state: "complete" },
];

function acceptedBranch(kind: "edit" | "regenerate"): EventPage {
  return page([
    {
      ...meta(4, "replacement-turn"),
      type: "branch",
      kind,
      target_message_key:
        kind === "edit" ? "original-request" : "original-answer",
      user_message_key: "original-request",
      content: kind === "edit" ? revisedText : originalText,
      removed_message_keys: ["original-answer"],
      removed_turn_ids: ["original-turn"],
    },
    {
      ...meta(5, "replacement-turn"),
      type: "message",
      sender: "agent",
      content: "Replacement answer",
      message_key: "replacement-answer",
      is_streaming: false,
    },
    {
      ...meta(6, "replacement-turn"),
      type: "turn_state_changed",
      state: "complete",
    },
  ]);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function setup(initialState: "complete" | "interrupted" = "complete") {
  const client = new AomiClient({
    baseUrl: "https://controlled-upstream.example",
    fetch: vi.fn(),
  });
  const start = vi.spyOn(client.agent, "start");
  vi.spyOn(client.agent, "poll").mockResolvedValue(
    page(
      history.map((event) =>
        event.type === "turn_state_changed"
          ? { ...event, state: initialState }
          : event,
      ),
    ),
  );
  const session = new Session(client, {
    sessionId,
    target: { mode: "direct", app: "original-app" },
    model: "original-model",
    clientId: "original-client",
  });
  await session.fetchCurrentState();
  return { session, start, client };
}

describe("ClientSession durable conversation intents", () => {
  it("forwards edit to the selected durable user message and projects the acknowledged replacement", async () => {
    const { session, start } = await setup();
    start.mockResolvedValue(acceptedBranch("edit"));
    await session.sendAsync(revisedText, { edit: "original-request" });
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        message: revisedText,
        edit: "original-request",
      }),
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    expect(start.mock.calls[0]![0]).not.toHaveProperty("regenerate");
    const userMessages = session
      .getSnapshot()
      .messages.filter((message) => message.sender === "user");
    expect(userMessages).toEqual([
      expect.objectContaining({
        message_key: "original-request",
        content: revisedText,
        turn_id: "replacement-turn",
      }),
    ]);
    expect(session.getSnapshot().events).toContainEqual(history[0]);
    expect(
      session
        .getSnapshot()
        .messages.some((message) => message.message_key === "original-answer"),
    ).toBe(false);
    session.close();
  });

  it.each(["edit", "regenerate"] as const)(
    "does not append an optimistic user message while %s awaits branch acknowledgment",
    async (kind) => {
      const { session, start } = await setup();
      const ack = deferred<EventPage>();
      start.mockReturnValue(ack.promise);
      const snapshots: Array<string | undefined> = [];
      const unsubscribe = session.subscribe(() =>
        snapshots.push(session.getSnapshot().pendingUserMessage),
      );
      const options: SendOptions =
        kind === "edit"
          ? { edit: "original-request" }
          : { regenerate: "original-answer" };
      const sent = session.sendAsync(
        kind === "edit" ? revisedText : originalText,
        options,
      );
      await Promise.resolve();
      expect(session.getSnapshot().isSubmitting).toBe(true);
      expect(session.getSnapshot().pendingUserMessage).toBeUndefined();
      expect(
        session
          .getSnapshot()
          .messages.filter((message) => message.sender === "user"),
      ).toEqual([history[0]]);
      expect(start.mock.calls[0]![0]).toMatchObject(options);
      ack.resolve(acceptedBranch(kind));
      await sent;
      expect(snapshots.every((pending) => pending === undefined)).toBe(true);
      expect(
        session
          .getSnapshot()
          .messages.filter((message) => message.sender === "user"),
      ).toHaveLength(1);
      unsubscribe();
      session.close();
    },
  );

  it.each(["edit", "regenerate"] as const)(
    "publishes %s immediately, keeps it pending through streaming and resets on terminal",
    async (kind) => {
      const { session, start, client } = await setup();
      const ack = deferred<EventPage>();
      start.mockReturnValue(ack.promise);
      const options =
        kind === "edit"
          ? { edit: "original-request" }
          : { regenerate: "original-answer" };
      const pending = {
        kind,
        messageKey: kind === "edit" ? "original-request" : "original-answer",
      };
      const sent = session.sendAsync(
        kind === "edit" ? revisedText : originalText,
        options,
      );
      // No microtask, network ACK or React render is required for the latch.
      expect(session.getSnapshot().isSubmitting).toBe(true);
      expect(session.getSnapshot().pendingBranch).toEqual(pending);
      const duplicate = session.sendAsync(
        kind === "edit" ? revisedText : originalText,
        options,
      );
      await Promise.resolve();
      expect(start).toHaveBeenCalledOnce();
      expect(start.mock.calls[0]![0]).toMatchObject({
        ...options,
        mode: "direct",
        app: "original-app",
        model: "original-model",
        clientId: "original-client",
      });
      ack.resolve({
        ...page([
          {
            ...meta(4, "replacement-turn"),
            type: "turn_state_changed",
            state: "processing",
          },
        ]),
        started_turn_id: "replacement-turn",
      });
      await Promise.all([sent, duplicate]);
      expect(session.getSnapshot().isSubmitting).toBe(false);
      expect(session.getSnapshot().pendingBranch).toEqual(pending);
      await expect(session.sendAsync(originalText, options)).rejects.toThrow(
        "Wait for the current generation",
      );
      expect(start).toHaveBeenCalledOnce();
      vi.mocked(client.agent.poll).mockResolvedValue(
        page([
          {
            ...meta(5, "replacement-turn"),
            type: "turn_state_changed",
            state: "failed",
          },
        ]),
      );
      await session.fetchCurrentState();
      expect(session.getSnapshot().pendingBranch).toBeUndefined();
      session.close();
    },
  );

  it("keeps the selected app/model while wallet preparation awaits, and resets branch feedback after Stop", async () => {
    const { session, start, client } = await setup();
    const walletState =
      deferred<Awaited<ReturnType<typeof client.prepareUserState>>>();
    const prepare = vi
      .spyOn(client, "prepareUserState")
      .mockReturnValue(walletState.promise);
    session.syncRuntimeOptions({
      target: { mode: "direct", app: "original-app" },
      model: "original-model",
      clientId: "original-client",
      getUserState: () => ({ ext: { selected: "original-chain-context" } }),
    });
    const sent = session.sendAsync(revisedText, { edit: "original-request" });
    await Promise.resolve();
    expect(prepare).toHaveBeenCalledOnce();
    session.syncRuntimeOptions({
      target: { mode: "auto" },
      model: "different-model",
      clientId: "different-client",
    });
    start.mockResolvedValue({
      ...page([
        {
          ...meta(4, "replacement-turn"),
          type: "turn_state_changed",
          state: "processing",
        },
      ]),
      started_turn_id: "replacement-turn",
    });
    walletState.resolve({ ext: { selected: "original-chain-context" } });
    await sent;
    expect(start.mock.calls[0]![0]).toMatchObject({
      mode: "direct",
      app: "original-app",
      model: "original-model",
      clientId: "original-client",
      userState: { ext: { selected: "original-chain-context" } },
    });
    expect(session.getSnapshot().pendingBranch?.kind).toBe("edit");
    vi.spyOn(client.agent, "interrupt").mockResolvedValue({
      ...page([]),
      terminal_turn: { turn_id: "replacement-turn", state: "interrupted" },
      stopped_turn_id: "replacement-turn",
    });
    await session.interrupt();
    expect(session.getSnapshot().pendingBranch).toBeUndefined();
    expect(session.getSnapshot().isSubmitting).toBe(false);
    session.close();
  });

  it("clears pending branch after a definitive rejected start and allows retry", async () => {
    const { session, start } = await setup();
    start.mockRejectedValueOnce(
      new AgentApiError(400, "invalid_edit", "Not saved", false),
    );
    const sent = session.sendAsync(revisedText, { edit: "original-request" });
    expect(session.getSnapshot().pendingBranch?.kind).toBe("edit");
    await expect(sent).rejects.toThrow("Not saved");
    expect(session.getSnapshot().pendingBranch).toBeUndefined();
    expect(session.getSnapshot().isSubmitting).toBe(false);
    start.mockResolvedValueOnce(acceptedBranch("edit"));
    await session.sendAsync(revisedText, { edit: "original-request" });
    expect(start).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot().pendingBranch).toBeUndefined();
    session.close();
  });

  it.each([
    [{ edit: "" }, "edit requires a durable user message key"],
    [{ edit: "   " }, "edit requires a durable user message key"],
    [
      { edit: "original-request", regenerate: "original-answer" },
      "edit and regenerate cannot be combined",
    ],
  ] as const)(
    "rejects invalid edit options %j before a network request",
    async (options, error) => {
      const { session, start, client } = await setup();
      const prepare = vi.spyOn(client, "prepareUserState");
      await expect(session.sendAsync(revisedText, options)).rejects.toThrow(
        error,
      );
      expect(start).not.toHaveBeenCalled();
      expect(prepare).not.toHaveBeenCalled();
      expect(session.getSnapshot().isSubmitting).toBe(false);
      expect(session.getSnapshot().messages).toEqual(
        history.filter((event) => event.type === "message"),
      );
      session.close();
    },
  );

  it("replays an uncertain edit with the same intent and idempotency key despite changed settings", async () => {
    const { session, start } = await setup();
    start.mockRejectedValueOnce(
      new AgentApiError(
        503,
        "upstream_unavailable",
        "Response unavailable",
        true,
      ),
    );
    start.mockResolvedValueOnce(acceptedBranch("edit"));
    await expect(
      session.sendAsync(revisedText, { edit: "original-request" }),
    ).rejects.toThrow("Response unavailable");
    session.syncRuntimeOptions({
      target: { mode: "auto" },
      model: "different-model",
      clientId: "different-client",
    });
    await session.sendAsync(revisedText, { edit: "original-request" });
    expect(start).toHaveBeenCalledTimes(2);
    expect(start.mock.calls[1]![0]).toEqual(start.mock.calls[0]![0]);
    expect(start.mock.calls[1]![0]).toMatchObject({
      edit: "original-request",
      message: revisedText,
      mode: "direct",
      app: "original-app",
      model: "original-model",
      clientId: "original-client",
    });
    expect(start.mock.calls[1]![1]?.idempotencyKey).toBe(
      start.mock.calls[0]![1]?.idempotencyKey,
    );
    expect(session.getSnapshot().pendingUserMessage).toBeUndefined();
    session.close();
  });

  it.each(["superseded", "unrelated"] as const)(
    "keeps Stop on the active branch when a %s callback completes late",
    async (scope) => {
      const { session, start, client } = await setup();
      const callbackTurn = "broadcast-terminal:old-batch";
      const branch = acceptedBranch("edit").events[0]!;
      if (branch.type !== "branch") throw new Error("Expected branch fixture");
      start.mockResolvedValue(
        page([
          {
            ...branch,
            removed_turn_ids:
              scope === "superseded"
                ? [...branch.removed_turn_ids, callbackTurn]
                : branch.removed_turn_ids,
          },
          {
            ...meta(5, "replacement-turn"),
            type: "turn_state_changed",
            state: "processing",
          },
        ]),
      );
      await session.sendAsync(revisedText, { edit: "original-request" });
      const lateAnswer: Event = {
        ...meta(6, callbackTurn),
        type: "message",
        sender: "agent",
        message_key: `${callbackTurn}:response`,
        content: "Old callback answer",
        is_streaming: false,
      };
      const lateComplete: Event = {
        ...meta(7, callbackTurn),
        type: "turn_state_changed",
        state: "complete",
      };
      vi.mocked(client.agent.poll).mockResolvedValue(
        page([lateAnswer, lateComplete]),
      );
      await session.sync();
      expect(session.getSnapshot()).toMatchObject({
        turnId: "replacement-turn",
        turnState: "processing",
        isStreaming: true,
      });
      expect(session.getSnapshot().events).toContainEqual(lateComplete);
      if (scope === "superseded") {
        expect(session.getSnapshot().messages).not.toContainEqual(lateAnswer);
      }
      const interrupt = vi.spyOn(client.agent, "interrupt").mockResolvedValue(
        page([
          {
            ...meta(8, "replacement-turn"),
            type: "turn_state_changed",
            state: "interrupted",
          },
        ]),
      );
      await session.interrupt();
      expect(interrupt).toHaveBeenCalledWith(sessionId, "replacement-turn");
      expect(session.getSnapshot()).toMatchObject({
        turnId: "replacement-turn",
        turnState: "interrupted",
        isStreaming: false,
      });
      session.close();
    },
  );

  it("allows the active turn's own admitted wallet callback to continue", async () => {
    const { session, start, client } = await setup();
    const branch = acceptedBranch("edit").events[0]!;
    start.mockResolvedValue(
      page([
        branch,
        {
          ...meta(5, "replacement-turn"),
          type: "turn_state_changed",
          state: "processing",
        },
        {
          ...meta(6, "replacement-turn"),
          type: "message",
          sender: "agent",
          content: "",
          message_key: "owned-admission",
          tool_name: "evm_commit_txs",
          tool_result: [
            "Commit",
            JSON.stringify({
              commits: [
                {
                  commit_id: "owned-commit",
                  batch: { batch_id: "owned-batch" },
                },
              ],
            }),
          ],
        },
      ]),
    );
    await session.sendAsync(revisedText, { edit: "original-request" });
    const callbackTurn = "broadcast-terminal:owned-batch";
    vi.mocked(client.agent.poll).mockResolvedValue(
      page([
        {
          ...meta(7, callbackTurn),
          type: "turn_state_changed",
          state: "processing",
        },
      ]),
    );
    await session.sync();
    expect(session.getSnapshot()).toMatchObject({
      turnId: callbackTurn,
      turnState: "processing",
      isStreaming: true,
    });
    session.close();
  });

  it("targets an accepted branch before its processing event reaches the next page", async () => {
    const { session, start, client } = await setup();
    start.mockResolvedValue(page([acceptedBranch("edit").events[0]!]));
    await session.sendAsync(revisedText, { edit: "original-request" });
    expect(session.getSnapshot()).toMatchObject({
      turnId: "replacement-turn",
      turnState: "processing",
      isSubmitting: false,
      isStreaming: true,
    });
    const interrupt = vi.spyOn(client.agent, "interrupt").mockResolvedValue(
      page([
        {
          ...meta(5, "replacement-turn"),
          type: "turn_state_changed",
          state: "interrupted",
        },
      ]),
    );
    await session.interrupt();
    expect(interrupt).toHaveBeenCalledWith(sessionId, "replacement-turn");
    expect(session.getSnapshot()).toMatchObject({
      turnState: "interrupted",
      isStreaming: false,
    });
    session.close();
  });

  it.each(["empty", "historical"] as const)(
    "honors a new ordinary start identity after Stop when the ACK page is %s",
    async (contents) => {
      const { session, start, client } = await setup("interrupted");
      expect(session.getSnapshot().stoppedTurnId).toBe("original-turn");
      const newTurn = "accepted-new-turn";
      const historical: Event[] =
        contents === "historical"
          ? [
              {
                ...meta(4, "older-unseen-turn"),
                type: "message",
                sender: "user",
                content: "Older unseen request",
                message_key: "older-unseen-request",
              },
              {
                ...meta(5, "older-unseen-turn"),
                type: "turn_state_changed",
                state: "complete",
              },
            ]
          : [];
      const ack = {
        ...page(historical),
        cursor: `cursor-${contents === "historical" ? 5 : 3}`,
        started_turn_id: newTurn,
      };
      start.mockResolvedValue(ack);
      await session.sendAsync("New ordinary request");
      expect(session.getSnapshot()).toMatchObject({
        turnId: newTurn,
        turnState: "processing",
        isSubmitting: false,
        isStreaming: true,
        pendingUserMessage: "New ordinary request",
      });
      expect(session.getSnapshot().stoppedTurnId).toBeUndefined();
      const interrupt = vi.spyOn(client.agent, "interrupt").mockResolvedValue({
        ...page([]),
        cursor: ack.cursor,
        stopped_turn_id: newTurn,
      });
      await session.interrupt();
      expect(interrupt).toHaveBeenCalledWith(sessionId, newTurn);
      expect(session.getSnapshot()).toMatchObject({
        turnId: newTurn,
        turnState: "interrupted",
        stoppedTurnId: newTurn,
        isStreaming: false,
      });
      vi.mocked(client.agent.poll).mockResolvedValue(
        page([
          {
            ...meta(6, newTurn),
            type: "message",
            sender: "user",
            content: "New ordinary request",
            message_key: "new-request",
          },
          {
            ...meta(7, newTurn),
            type: "turn_state_changed",
            state: "interrupted",
          },
        ]),
      );
      await session.sync();
      expect(session.getSnapshot().pendingUserMessage).toBeUndefined();
      expect(
        session
          .getSnapshot()
          .messages.filter((message) => message.message_key === "new-request"),
      ).toHaveLength(1);
      expect(session.getSnapshot()).toMatchObject({
        turnId: newTurn,
        turnState: "interrupted",
        isStreaming: false,
      });
      session.close();
    },
  );

  it("preserves the new run's matching terminal state carried by a start ACK", async () => {
    const { session, start } = await setup("interrupted");
    const newTurn = "already-finished-new-turn";
    start.mockResolvedValue({
      ...page([
        {
          ...meta(4, newTurn),
          type: "message",
          sender: "user",
          content: "New ordinary request",
          message_key: "new-request",
        },
        {
          ...meta(5, newTurn),
          type: "message",
          sender: "agent",
          content: "New answer",
          message_key: "new-answer",
          is_streaming: false,
        },
        { ...meta(6, newTurn), type: "turn_state_changed", state: "complete" },
      ]),
      started_turn_id: newTurn,
    });
    await session.sendAsync("New ordinary request");
    expect(session.getSnapshot()).toMatchObject({
      turnId: newTurn,
      turnState: "complete",
      isStreaming: false,
      isSubmitting: false,
    });
    expect(session.getSnapshot().pendingUserMessage).toBeUndefined();
    expect(session.getSnapshot().stoppedTurnId).toBeUndefined();
    session.close();
  });
});
