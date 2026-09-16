import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

describe("CLI session lifecycle", () => {
  let stateDir: string;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
    stateDir = mkdtempSync(join(tmpdir(), "aomi-cli-session-"));
    process.env.AOMI_STATE_DIR = stateDir;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
    rmSync(stateDir, { recursive: true, force: true });
  });

  it("creates a fresh active session instead of reusing the current one", async () => {
    const { CliSession } = await import("../../src/cli/cli-session");
    const { listStoredSessions, readState } =
      await import("../../src/cli/state");

    const config = {
      baseUrl: "https://api.aomi.dev",
      app: "default",
      execution: "eoa" as const,
      secrets: {},
    };

    const first = CliSession.loadOrCreate(config);
    const firstSession = first.createClientSession();
    firstSession.close();

    const reused = CliSession.loadOrCreate(config);
    const reusedSession = reused.createClientSession();
    reusedSession.close();

    expect(reused.sessionId).toBe(first.sessionId);
    expect(reused.clientId).toBe(first.clientId);

    const fresh = CliSession.create(config);

    expect(fresh.sessionId).not.toBe(first.sessionId);
    expect(fresh.clientId).not.toBe(first.clientId);
    expect(readState()?.sessionId).toBe(fresh.sessionId);
    expect(readState()?.clientId).toBe(fresh.clientId);
    expect(listStoredSessions().map((session) => session.sessionId)).toEqual([
      first.sessionId,
      fresh.sessionId,
    ]);
  });

  it("supports newSessionCommand as an explicit fresh-session command", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { CliSession } = await import("../../src/cli/cli-session");
    const { newSessionCommand } =
      await import("../../src/cli/commands/sessions");
    const { readState } = await import("../../src/cli/state");

    const config = {
      baseUrl: "https://api.aomi.dev",
      app: "default",
      execution: "eoa" as const,
      secrets: {},
    };

    const existing = CliSession.loadOrCreate({
      ...config,
      chain: 11155111,
    });
    existing.setWallet(
      "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "0xFCAd0B19bB29D4674531d6f115237E16AfCE377c",
    );
    existing.setAuthSession({
      sessionToken: "bff-session-token",
      expiresAt: Date.now() + 60_000,
      walletAddress: "0xFCAd0B19bB29D4674531d6f115237E16AfCE377c",
      chainId: 11155111,
    });

    newSessionCommand(config);

    const state = readState();
    expect(state?.sessionId).toBeDefined();
    expect(state?.sessionId).not.toBe(existing.sessionId);
    expect(state?.auth?.sessionToken).toBe("bff-session-token");
    expect(state?.privateKey).toBe(
      "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    );
    expect(state?.chainId).toBe(11155111);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Active session set to"),
    );
  });

  it("imports an account-owned remote session when resume has no local match", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { AgentSessionsTransport } =
      await import("../../src/agent/transport");
    const getSession = vi
      .spyOn(AgentSessionsTransport.prototype, "get")
      .mockResolvedValue({
        id: "mcp-remote-thread",
        title: null,
        updatedAt: 1,
        archived: false,
      });
    const { CliSession } = await import("../../src/cli/cli-session");
    const { resumeSessionCommand } =
      await import("../../src/cli/commands/sessions");
    const { readState } = await import("../../src/cli/state");

    const current = CliSession.create({
      baseUrl: "https://chat.aomi.dev",
      app: "default",
      secrets: {},
    });
    current.setAuthSession({
      sessionToken: "bff-session-token",
      expiresAt: Date.now() + 60_000,
    });

    await resumeSessionCommand("mcp-remote-thread");

    expect(getSession).toHaveBeenCalledWith("mcp-remote-thread");
    expect(readState()?.sessionId).toBe("mcp-remote-thread");
    expect(readState()?.auth?.sessionToken).toBe("bff-session-token");
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("imported remote session"),
    );
  });

  it("interrupts the active session through the shared Agent transport", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { AgentTransport } = await import("../../src/agent/transport");
    vi.spyOn(AgentTransport.prototype, "poll").mockResolvedValue({
      session_id: "cli-interrupt-session",
      cursor: "cursor-1",
      events: [
        {
          type: "turn_state_changed",
          event_id: "event-processing",
          sequence: 1,
          turn_id: "turn-1",
          occurred_at: 1,
          state: "processing",
        },
      ],
      has_more: false,
    });
    const interrupt = vi
      .spyOn(AgentTransport.prototype, "interrupt")
      .mockResolvedValue({
        session_id: "cli-interrupt-session",
        cursor: "cursor-1",
        events: [
          {
            type: "turn_state_changed",
            event_id: "event-interrupted",
            sequence: 2,
            turn_id: "turn-1",
            occurred_at: 2,
            state: "interrupted",
          },
        ],
        has_more: false,
      });
    const { CliSession } = await import("../../src/cli/cli-session");
    const { interruptCommand } = await import("../../src/cli/commands/control");

    CliSession.create(
      {
        baseUrl: "https://chat.aomi.dev",
        accountBearer: "bff-session-token",
        secrets: {},
      },
      undefined,
      "cli-interrupt-session",
    );

    await interruptCommand({ secrets: {} });

    expect(interrupt).toHaveBeenCalledWith("cli-interrupt-session", "turn-1");
    expect(logSpy).toHaveBeenCalledWith(
      "Interrupted session cli-interrupt-session.",
    );
  });

  it("uses an explicit scoped bearer for Agent public API requests", async () => {
    const { CliSession } = await import("../../src/cli/cli-session");
    const cli = CliSession.create({
      baseUrl: "https://api.aomi.dev",
      accountBearer: "scoped-agent-bearer",
      secrets: {},
    });

    const oauth = cli.createOAuthProvider(fetch);
    const token = await oauth?.({
      resource: "https://api.aomi.dev/v1/agent",
      scopes: ["agent:write"],
    });

    expect(token).toEqual({
      accessToken: "scoped-agent-bearer",
      expiresAt: Number.MAX_SAFE_INTEGER,
      resource: "https://api.aomi.dev/v1/agent",
      scopes: ["agent:write"],
      tokenType: "Bearer",
    });
  });

  it("uses an anonymous bearer for Agent requests without an OAuth grant", async () => {
    vi.stubGlobal("location", undefined);
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        if (path === "/api/auth/sign-in/anonymous") {
          return Response.json({ token: "guest-session" });
        }
        if (path === "/v1/agent/sessions") {
          if (
            new Headers(init?.headers).get("authorization") !==
            "Bearer guest-session"
          ) {
            return Response.json(
              { error: { code: "invalid_token" } },
              { status: 401 },
            );
          }
          return Response.json({ sessions: [] });
        }
        return new Response(null, { status: 404 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const { CliSession } = await import("../../src/cli/cli-session");
    const cli = CliSession.create({
      baseUrl: "https://chat-staging.aomi.dev",
      secrets: {},
    });
    const session = cli.createClientSession();

    await expect(session.client.agent.sessions.list()).resolves.toEqual({
      sessions: [],
    });
    session.close();

    expect(
      fetchMock.mock.calls.map(([input]) => new URL(String(input)).pathname),
    ).toEqual(["/api/auth/sign-in/anonymous", "/v1/agent/sessions"]);
  });

  it("reuses the anonymous bearer across CLI process sessions", async () => {
    vi.stubGlobal("location", undefined);
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        if (path === "/api/auth/sign-in/anonymous") {
          return Response.json({ token: "guest-session" });
        }
        if (path === "/v1/agent/sessions") {
          expect(new Headers(init?.headers).get("authorization")).toBe(
            "Bearer guest-session",
          );
          return Response.json({ sessions: [] });
        }
        return new Response(null, { status: 404 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const { CliSession } = await import("../../src/cli/cli-session");
    const { readState } = await import("../../src/cli/state");
    const first = CliSession.create({
      baseUrl: "https://chat-staging.aomi.dev",
      secrets: {},
    });
    const firstClient = first.createClientSession();
    await firstClient.client.agent.sessions.list();
    firstClient.close();

    const reloaded = CliSession.load();
    const secondClient = reloaded?.createClientSession();
    await secondClient?.client.agent.sessions.list();
    secondClient?.close();

    expect(readState()?.guestBearer).toBe("guest-session");
    expect(
      fetchMock.mock.calls.filter(
        ([input]) =>
          new URL(String(input)).pathname === "/api/auth/sign-in/anonymous",
      ),
    ).toHaveLength(1);
  });

  it("persists explicit wallet, chain, and backend settings on the active session", async () => {
    const { setWalletCommand, setChainCommand, setBackendCommand } =
      await import("../../src/cli/commands/preferences");
    const { readState } = await import("../../src/cli/state");

    setWalletCommand(
      "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    );
    setChainCommand("1");
    setBackendCommand("http://127.0.0.1:18765");

    expect(readState()).toEqual(
      expect.objectContaining({
        baseUrl: "http://127.0.0.1:18765",
        chainId: 1,
        publicKey: "0xFCAd0B19bB29D4674531d6f115237E16AfCE377c",
        privateKey:
          "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      }),
    );
  });

  it("writes state directories and session files with private permissions", async () => {
    const { CliSession } = await import("../../src/cli/cli-session");
    const { STATE_ROOT_DIR, SESSIONS_DIR, getActiveStateFilePath } =
      await import("../../src/cli/state");

    CliSession.loadOrCreate({
      baseUrl: "https://api.aomi.dev",
      app: "default",
      privateKey:
        "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      execution: "eoa" as const,
      secrets: {},
    });

    const activePath = getActiveStateFilePath();
    expect(activePath).toBeTruthy();
    expect(statSync(STATE_ROOT_DIR).mode & 0o777).toBe(0o700);
    expect(statSync(SESSIONS_DIR).mode & 0o777).toBe(0o700);
    expect(statSync(activePath!).mode & 0o777).toBe(0o600);
    expect(statSync(join(stateDir, "active-session.txt")).mode & 0o777).toBe(
      0o600,
    );
  });

  it("preserves saved wallet, chain, and backend settings across fresh sessions", async () => {
    const { CliSession } = await import("../../src/cli/cli-session");

    const initial = CliSession.loadOrCreate({
      baseUrl: "http://127.0.0.1:18765",
      app: "default",
      chain: 1,
      publicKey: "0xabc",
      execution: "eoa" as const,
      secrets: {},
    });
    initial.setWallet(
      "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "0xabc",
    );

    const fresh = CliSession.loadOrCreate({
      baseUrl: "https://api.aomi.dev",
      app: "default",
      freshSession: true,
      execution: "eoa" as const,
      secrets: {},
    });

    expect(fresh.sessionId).not.toBe(initial.sessionId);
    expect(fresh.publicKey).toBe("0xabc");
    expect(fresh.privateKey).toBe(
      "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    );
    expect(fresh.chainId).toBe(1);
    expect(fresh.baseUrl).toBe("https://api.aomi.dev");
  });

  it("does not persist private keys supplied as one-shot config", async () => {
    const { CliSession } = await import("../../src/cli/cli-session");
    const { readState } = await import("../../src/cli/state");

    CliSession.loadOrCreate({
      baseUrl: "https://api.aomi.dev",
      app: "default",
      privateKey:
        "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      solanaPrivateKey: JSON.stringify(Array(64).fill(1)),
      execution: "eoa" as const,
      secrets: {},
    });

    expect(readState()).toEqual(
      expect.objectContaining({
        privateKey: undefined,
        svmPrivateKey: undefined,
      }),
    );
  });

  it("persists a cluster when one-shot config adds an SVM address to an existing session", async () => {
    const { CliSession } = await import("../../src/cli/cli-session");
    const { readState } = await import("../../src/cli/state");
    const keypair = Keypair.fromSeed(Uint8Array.from(Array(32).fill(1)));
    const config = {
      baseUrl: "https://api.aomi.dev",
      app: "default",
      execution: "eoa" as const,
      secrets: {},
    };

    CliSession.loadOrCreate(config);
    CliSession.loadOrCreate({
      ...config,
      solanaPrivateKey: JSON.stringify(Array.from(keypair.secretKey)),
    });

    expect(readState()).toEqual(
      expect.objectContaining({
        svmPublicKey: keypair.publicKey.toBase58(),
        svmCluster: "solana:mainnet",
        svmPrivateKey: undefined,
      }),
    );
  });

  it("stamps solana:mainnet onto legacy state files with an SVM wallet but no cluster", async () => {
    const { SESSIONS_DIR, readState } = await import("../../src/cli/state");
    const { CliSession } = await import("../../src/cli/cli-session");

    mkdirSync(SESSIONS_DIR, { recursive: true });
    writeFileSync(
      join(SESSIONS_DIR, "session-1.json"),
      JSON.stringify({
        sessionId: "legacy",
        localId: 1,
        baseUrl: "https://api.aomi.dev",
        svmPublicKey: "J2w7ZT5Wd4ACuQAH3dmzjWoRhaqejMRoMRL4C7Qbg5Ks",
      }),
    );
    writeFileSync(join(stateDir, "active-session.txt"), "1");

    const cli = CliSession.load();
    expect(cli?.svmCluster).toBe("solana:mainnet");
    // The invariant is persisted, not just in-memory.
    expect(readState()?.svmCluster).toBe("solana:mainnet");
  });

  it("persists the account bearer on the active session", async () => {
    const { CliSession } = await import("../../src/cli/cli-session");
    const { readState } = await import("../../src/cli/state");

    CliSession.loadOrCreate({
      baseUrl: "https://api.aomi.dev",
      app: "default",
      execution: "eoa" as const,
      secrets: {},
      accountBearer: "bearer-1",
    });

    expect(readState()?.accountBearer).toBe("bearer-1");
  });
});
