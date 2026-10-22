// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { AomiClient, Session } from "./";
import { createFakeAgentServer } from "../../../tests/e2e/fake-backend/server";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function setup() {
  const server = await createFakeAgentServer();
  server.backend.enableTurnInput();
  cleanup.push(() => server.close());
  const client = new AomiClient({ baseUrl: server.origin, guest: false });
  const session = new Session(client, { sessionId: "http-steering" });
  cleanup.push(() => session.close());
  return { ...server, client, session };
}

describe("shared inputs over real HTTP and SSE", () => {
  it("shows the next active turn after a terminal rejection while keeping the correction bound to the old turn", async () => {
    const { session: first, client, backend } = await setup();
    const steers = vi.spyOn(client.agent, "steer");
    cleanup.push(() => steers.mockRestore());
    await first.sendAsync("[slow] first request");
    const second = new Session(client, { sessionId: first.sessionId });
    cleanup.push(() => second.close());
    await second.sync();
    const oldTarget = second.getSnapshot().control!.active_turn_id!;
    const queued = await first.queue("[slow] second request", {
      inputId: "next-request",
    });
    backend.completeActiveInput(first.sessionId, "First answer");

    await expect(
      second.steer("Retain this old correction", {
        inputId: "late-correction",
        targetTurnId: oldTarget,
      }),
    ).rejects.toMatchObject({ code: "target_terminal" });
    expect(second.getSnapshot()).toMatchObject({
      turnId: queued.input!.turn_id,
      turnState: "processing",
      control: {
        active_turn_id: queued.input!.turn_id,
        accepted_input_revision: 1,
      },
    });
    expect(second.getSnapshot().inputs).toEqual([
      expect.objectContaining({
        inputId: "late-correction",
        targetTurnId: oldTarget,
        message: "Retain this old correction",
        status: "rejected",
      }),
    ]);
    const originalRequest = steers.mock.calls.at(-1)!;
    expect(originalRequest[1]).toMatchObject({
      turnId: oldTarget,
      expectedInputRevision: 1,
    });
    expect(steers).toHaveBeenCalledTimes(1);
    await expect(second.retryInput("late-correction")).rejects.toMatchObject({
      code: "target_terminal",
    });
    expect(steers.mock.calls.at(-1)).toEqual(originalRequest);
    expect(backend.starts()).toHaveLength(2);
    expect(
      backend
        .events(first.sessionId)
        .some(
          (event) =>
            event.type === "turn_input" && event.input_id === "late-correction",
        ),
    ).toBe(false);
  });

  it("refreshes a stale client's revision from rejection without resending its correction", async () => {
    const { session: first, client, backend } = await setup();
    const steers = vi.spyOn(client.agent, "steer");
    cleanup.push(() => steers.mockRestore());
    await first.sendAsync("[slow] research");
    const second = new Session(client, { sessionId: first.sessionId });
    cleanup.push(() => second.close());
    await second.sync();
    const target = second.getSnapshot().control!.active_turn_id!;
    await first.steer("Use Base", { inputId: "other-client-update" });
    expect(second.getSnapshot().control?.accepted_input_revision).toBe(1);

    await expect(
      second.steer("Keep my draft", {
        inputId: "stale-client-update",
        targetTurnId: target,
      }),
    ).rejects.toMatchObject({ code: "revision_conflict" });
    expect(second.getSnapshot().control).toMatchObject({
      active_turn_id: target,
      accepted_input_revision: 2,
    });
    expect(second.getSnapshot().inputs).toEqual([
      expect.objectContaining({
        inputId: "stale-client-update",
        message: "Keep my draft",
        targetTurnId: target,
        status: "rejected",
      }),
    ]);
    const firstAttempt = steers.mock.calls.at(-1)!;
    expect(firstAttempt[1]).toMatchObject({
      turnId: target,
      expectedInputRevision: 1,
      message: "Keep my draft",
    });
    expect(backend.requestsSince(0, "chat.steer")).toHaveLength(2);

    await expect(
      second.retryInput("stale-client-update"),
    ).rejects.toMatchObject({ code: "revision_conflict" });
    const explicitRetry = steers.mock.calls.at(-1)!;
    expect(explicitRetry).toEqual(firstAttempt);
    expect(backend.requestsSince(0, "chat.steer")).toHaveLength(3);
    expect(backend.starts()).toHaveLength(1);
    expect(
      backend
        .events(first.sessionId)
        .filter(
          (event) =>
            event.type === "turn_input" &&
            event.input_id === "stale-client-update",
        ),
    ).toHaveLength(0);
  });

  it("keeps correction receipts on one target and admits queued work behind it", async () => {
    const { session, backend } = await setup();
    await session.sendAsync("[slow] research token");
    const original = session.getSnapshot().control!.active_turn_id;
    const [one, two] = await Promise.all([
      session.steer("Use 5 instead", { inputId: "http-one" }),
      session.steer("Use Base", { inputId: "http-two" }),
    ]);
    expect([one.input?.turn_id, two.input?.turn_id]).toEqual([
      original,
      original,
    ]);
    expect([one.input?.input_revision, two.input?.input_revision]).toEqual([
      2, 3,
    ]);
    const queued = await session.queue("Independent research", {
      inputId: "http-queue",
    });
    expect(queued.input?.disposition).toBe("queued");
    expect(session.getSnapshot().control?.active_turn_id).toBe(original);
    expect(session.getSnapshot().control?.queued_turn_ids).toEqual([
      queued.input?.turn_id,
    ]);
    expect(backend.starts()).toHaveLength(2);
    backend.applySteering(session.sessionId);
    await session.sync();
    expect(
      session
        .getSnapshot()
        .inputs?.filter((input) => input.operation === "steer")
        .map((input) => input.status),
    ).toEqual(["applied", "applied"]);
    expect(
      session
        .getSnapshot()
        .messages.filter((message) => message.content === "Use 5 instead"),
    ).toHaveLength(1);
    backend.completeActiveInput(session.sessionId, "Research with 5 on Base");
    await session.sync();
    expect(session.getSnapshot().control?.active_turn_id).toBe(
      queued.input?.turn_id,
    );
    expect(session.getSnapshot().control?.queued_turn_ids).toEqual([]);
    expect(
      session
        .getSnapshot()
        .messages.some((message) => message.content === "Independent research"),
    ).toBe(true);
  });

  it("waits behind approval and invalidates that approval when a correction is accepted", async () => {
    const { session, backend } = await setup();
    await session.sendAsync("[tx] Transfer 1 wei");
    const original = session.getSnapshot().control?.active_turn_id;
    const approval = session.getSnapshot().actions.at(-1)!;
    expect(approval.state).toBe("pending");
    const queued = await session.queue("A separate request", {
      inputId: "after-approval",
    });
    await session.sync();
    expect(session.getSnapshot().control?.active_turn_id).toBe(original);
    expect(session.getSnapshot().control?.queued_turn_ids).toEqual([
      queued.input?.turn_id,
    ]);
    await session.steer("Change transfer to 2 wei", {
      inputId: "approval-correction",
    });
    expect(session.getSnapshot().actions.at(-1)).toMatchObject({
      id: approval.id,
      revision: approval.revision + 1,
      state: "rejected",
      result: {
        status: "rejected",
        reason: "superseded_by_input:approval-correction",
      },
    });
    await session.steer("Keep the revised transfer", {
      inputId: "approval-follow-up",
    });
    expect(session.getSnapshot().actions.at(-1)).toMatchObject({
      revision: approval.revision + 1,
      state: "rejected",
      result: { reason: "superseded_by_input:approval-correction" },
    });
    expect(
      backend
        .events(session.sessionId)
        .filter((event) => event.type === "action"),
    ).toHaveLength(2);
    expect(backend.requestsSince(0, "chat.steer")).toHaveLength(2);
  });

  it("rejects a terminal target over HTTP and retains text without creating another turn", async () => {
    const { session, backend, client } = await setup();
    await session.sendAsync("[slow] running");
    const target = session.getSnapshot().control!.active_turn_id!;
    backend.finishBeforeNextSteer();
    await expect(
      session.steer("Keep this correction", {
        targetTurnId: target,
        inputId: "terminal-draft",
      }),
    ).rejects.toMatchObject({ code: "target_terminal" });
    expect(
      session
        .getSnapshot()
        .inputs?.find((input) => input.inputId === "terminal-draft"),
    ).toMatchObject({
      status: "rejected",
      message: "Keep this correction",
      targetTurnId: target,
    });
    expect(backend.starts()).toHaveLength(1);
    expect(backend.requestsSince(0, "chat.steer")).toHaveLength(1);
    // HTTP idempotency binds input content, not merely the input identity.
    const accepted = await client.agent.start(
      { sessionId: "second-session", message: "[slow] original" },
      { idempotencyKey: "content-bound" },
    );
    expect(accepted.started_turn_id).toBeTruthy();
    await expect(
      client.agent.start(
        { sessionId: "second-session", message: "[slow] changed" },
        { idempotencyKey: "content-bound" },
      ),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
  });
  it("replays an accepted HTTP input after the response socket is lost", async () => {
    const { client, backend, loseNextResponse } = await setup();
    const started = await client.agent.start(
      { sessionId: "socket-loss", message: "[slow] original" },
      { idempotencyKey: "socket-original" },
    );
    const intent = {
      turnId: started.started_turn_id!,
      expectedInputRevision: 1,
      message: "Use Base",
    };
    loseNextResponse("/v1/agent/chat/socket-loss/steer");
    await expect(
      client.agent.steer("socket-loss", intent, "socket-correction"),
    ).rejects.toThrow();
    const replay = await client.agent.steer(
      "socket-loss",
      intent,
      "socket-correction",
    );
    expect(replay.input).toMatchObject({
      input_id: "socket-correction",
      turn_id: started.started_turn_id,
      input_revision: 2,
    });
    expect(
      backend
        .events("socket-loss")
        .filter(
          (event) =>
            event.type === "turn_input" &&
            event.input_id === "socket-correction",
        ),
    ).toHaveLength(1);
    await expect(
      client.agent.steer(
        "socket-loss",
        { ...intent, message: "Changed content" },
        "socket-correction",
      ),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
  });
});
