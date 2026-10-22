import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@aomi-labs/client";
import type { CliConfig } from "../types";

const ORIGINAL_ENV = { ...process.env };

describe("interactive CLI saved-session changes", () => {
  let directory: string;
  let chat:
    | Awaited<ReturnType<(typeof import("./chat"))["openInteractiveChat"]>>
    | undefined;

  beforeEach(() => {
    vi.resetModules();
    directory = mkdtempSync(join(tmpdir(), "aomi-cli-interactive-"));
    process.env = { ...ORIGINAL_ENV, AOMI_STATE_DIR: directory };
    vi.stubGlobal("location", undefined);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    chat?.close();
    chat = undefined;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
    rmSync(directory, { recursive: true, force: true });
  });

  async function fixture(config: CliConfig = { secrets: {} }) {
    const { Session } = await import("@aomi-labs/client");
    // Exercise actual request construction/auth, but keep observation local and
    // deterministic: SSE itself is covered by the SDK's stream tests.
    vi.spyOn(Session.prototype, "startStreaming").mockImplementation(() => {});
    const subscriptions = new Map<Session, ReturnType<typeof vi.fn>>();
    const observations = new Map<Session, ReturnType<typeof vi.fn>>();
    const close = vi.spyOn(Session.prototype, "close");
    const requests: {
      url: URL;
      headers: Headers;
      body?: Record<string, unknown>;
    }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const headers = new Headers(init?.headers);
        const body =
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : undefined;
        requests.push({ url, headers, body });
        if (url.pathname === "/api/secrets")
          return Response.json({
            handles: { TEST_KEY: "local-secret-handle" },
          });
        if (url.pathname === "/v1/agent/sessions")
          return Response.json({ sessions: [] });
        const id = String(
          body?.sessionId ??
            decodeURIComponent(url.pathname.split("/").at(-1)!),
        );
        const queued = body?.intent === "queue";
        return Response.json({
          session_id: id,
          events: [],
          has_more: false,
          cursor: `cursor-${id}`,
          capabilities: { turn_input: 1 },
          control: {
            stream_epoch: `epoch-${id}`,
            event_sequence: 1,
            active_turn_id: null,
            accepted_input_revision: 0,
            applied_input_revision: 0,
            queued_turn_ids: queued ? ["queued-turn"] : [],
          },
          ...(queued
            ? {
                input: {
                  input_id: headers.get("idempotency-key"),
                  turn_id: "queued-turn",
                  operation: "queue",
                  disposition: "queued",
                  input_revision: 1,
                  received_at: 1,
                  admitted_at: 1,
                  applied_at: null,
                },
              }
            : {}),
        });
      }),
    );
    const { CliSession } = await import("../cli-session");
    const create = CliSession.prototype.createClientSession;
    vi.spyOn(CliSession.prototype, "createClientSession").mockImplementation(
      function (this: import("../cli-session").CliSession, options, listeners) {
        const current = create.call(this, options, listeners);
        const subscribe = current.subscribe;
        const observe = current.observe.bind(current);
        vi.spyOn(current, "subscribe").mockImplementation((listener) => {
          const release = vi.fn(subscribe(listener));
          subscriptions.set(current, release);
          return release;
        });
        vi.spyOn(current, "observe").mockImplementation(() => {
          const release = vi.fn(observe());
          observations.set(current, release);
          return release;
        });
        return current;
      },
    );
    const { readState, writeState } = await import("../state");
    CliSession.create(
      {
        baseUrl: "https://old.example",
        accountBearer: "old-token",
        secrets: {},
      },
      undefined,
      "old-thread",
    );
    const { openInteractiveChat } = await import("./chat");
    chat = await openInteractiveChat(config, false);
    return {
      CliSession,
      readState,
      writeState,
      requests,
      subscriptions,
      observations,
      close,
      interaction: chat,
    };
  }

  it("replaces server/thread identity before input and detaches the old observer and renderer", async () => {
    const state = await fixture({
      accountBearer: "old-token",
      secrets: { TEST_KEY: "old-secret" },
    });
    const old = state.interaction.session;
    const before = state.requests.length;
    state.CliSession.create(
      {
        baseUrl: "https://new.example",
        accountBearer: "new-token",
        secrets: {},
      },
      undefined,
      "new-thread",
    );
    // No explicit sync call: an external process can switch the saved session
    // while the REPL is waiting for its next line.
    await state.interaction.queue("Work on the newly selected thread");
    const current = state.interaction.session;
    expect(current).not.toBe(old);
    expect(current.sessionId).toBe("new-thread");
    expect(state.subscriptions.get(old)).toHaveBeenCalledTimes(1);
    expect(state.observations.get(old)).toHaveBeenCalledTimes(1);
    expect(
      state.close.mock.contexts.filter((session) => session === old),
    ).toHaveLength(1);
    const next = state.requests.slice(before);
    expect(next.length).toBeGreaterThan(0);
    for (const request of next) {
      expect(request.url.origin).toBe("https://new.example");
      expect(request.headers.get("authorization")).toBe("Bearer new-token");
      expect(request.url.pathname).not.toBe("/api/secrets");
      expect(JSON.stringify(request.body) ?? "").not.toContain("old-secret");
      if (request.body) expect(request.body.sessionId).toBe("new-thread");
    }
    state.interaction.close();
    expect(state.subscriptions.get(current)).toHaveBeenCalledTimes(1);
    expect(state.observations.get(current)).toHaveBeenCalledTimes(1);
  });

  it("replaces a rotated credential on the same server and thread without restoring startup auth", async () => {
    const state = await fixture({ accountBearer: "old-token", secrets: {} });
    const old = state.interaction.session;
    state.writeState({ ...state.readState()!, accountBearer: "rotated-token" });
    const before = state.requests.length;
    await state.interaction.sync();
    await state.interaction.session.client.agent.sessions.list();
    expect(state.interaction.session).not.toBe(old);
    expect(state.interaction.session.sessionId).toBe("old-thread");
    expect(
      state.requests
        .slice(before)
        .every(
          (request) =>
            request.headers.get("authorization") === "Bearer rotated-token",
        ),
    ).toBe(true);
    expect(state.readState()?.accountBearer).toBe("rotated-token");
    expect(state.subscriptions.get(old)).toHaveBeenCalledTimes(1);
    expect(state.observations.get(old)).toHaveBeenCalledTimes(1);
  });

  it("replaces a thread even when its server and credentials are unchanged", async () => {
    const state = await fixture();
    const old = state.interaction.session;
    state.CliSession.create(
      { secrets: {} },
      state.readState()!,
      "another-thread",
    );
    await state.interaction.sync();
    expect(state.interaction.session).not.toBe(old);
    expect(state.interaction.session.sessionId).toBe("another-thread");
    await state.interaction.queue("Separate saved conversation");
    expect(state.requests.at(-1)?.body?.sessionId).toBe("another-thread");
    expect(state.requests.at(-1)?.headers.get("authorization")).toBe(
      "Bearer old-token",
    );
  });

  it("keeps the live client and subscriptions for same-identity runtime preference changes", async () => {
    const state = await fixture();
    const old = state.interaction.session;
    state.CliSession.load()!.setModel("gpt-6-luna");
    await state.interaction.sync();
    expect(state.interaction.session).toBe(old);
    expect(state.subscriptions.get(old)).not.toHaveBeenCalled();
    expect(state.observations.get(old)).not.toHaveBeenCalled();
    await state.interaction.queue("Use the saved model");
    expect(state.requests.at(-1)?.body?.model).toBe("gpt-6-luna");
    expect(state.requests.at(-1)?.headers.get("authorization")).toBe(
      "Bearer old-token",
    );
    expect(
      state.close.mock.contexts.filter((session) => session === old),
    ).toHaveLength(0);
  });

  it("drops a startup signing key after a same-server saved wallet switch", async () => {
    const { privateKeyToAccount } = await import("viem/accounts");
    const capabilities = await import("../action-capabilities");
    const build = capabilities.cliWallets;
    const wallets: ReturnType<typeof build>[] = [];
    vi.spyOn(capabilities, "cliWallets").mockImplementation((...args) => {
      const wallet = build(...args);
      wallets.push(wallet);
      return wallet;
    });
    const oldKey = `0x${"11".repeat(32)}` as const;
    const newKey = `0x${"22".repeat(32)}` as const;
    const config: CliConfig = { privateKey: oldKey, secrets: {} };
    const state = await fixture(config);
    const old = state.interaction.session;
    expect(wallets.at(-1)?.evm?.address).toBe(
      privateKeyToAccount(oldKey).address,
    );
    const nextAddress = privateKeyToAccount(newKey).address;
    state.CliSession.load()!.setWallet(newKey, nextAddress);
    await state.interaction.sync();
    expect(state.interaction.session).not.toBe(old);
    // Inspect the real wallet capability constructed for the replacement:
    // it must derive from the new saved key, even though startup config still
    // holds the old explicit key. Constructing it performs no RPC/signing.
    expect(wallets.at(-1)?.evm?.address).toBe(nextAddress);
    expect(config.privateKey).toBe(oldKey);
    expect(state.subscriptions.get(old)).toHaveBeenCalledTimes(1);
    expect(state.observations.get(old)).toHaveBeenCalledTimes(1);
    expect(
      state.requests.every(
        (request) => request.url.origin === "https://old.example",
      ),
    ).toBe(true);
  });
});
