import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Action } from "../../src/agent/types";

const PRIVATE_KEY =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const ORIGINAL_ENV = { ...process.env };

function action(id: string): Action {
  return {
    type: "action",
    event_id: `event-${id}`,
    sequence: 1,
    turn_id: "turn-1",
    occurred_at: 1,
    id,
    revision: 1,
    state: "pending",
    request: {
      type: "execute_evm",
      transactions: [
        {
          chain_id: 1,
          from: "0xFCAd0B19bB29D4674531d6f115237E16AfCE377c",
          to: "0x1111111111111111111111111111111111111111",
          data: "0x",
          label: "Transfer",
          kind: "transfer",
        },
      ],
    },
    result: null,
    created_at: 1,
    expires_at: null,
  };
}

describe("CLI Action capabilities", () => {
  let stateDir: string;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
    stateDir = mkdtempSync(join(tmpdir(), "aomi-cli-actions-"));
    process.env.AOMI_STATE_DIR = stateDir;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    rmSync(stateDir, { recursive: true, force: true });
  });

  it("installs an EVM capability on the session ActionHandler", async () => {
    const { CliSession } = await import("../../src/cli/cli-session");
    const cli = CliSession.create({
      baseUrl: "https://api.aomi.dev",
      app: "default",
      secrets: {},
      privateKey: PRIVATE_KEY,
    });
    const session = cli.createClientSession({ privateKey: PRIVATE_KEY });
    session.actions.ingest(action("action-1"));

    expect(session.actions.canExecute("action-1")).toBe(true);
    session.close();
  });

  it("leaves execution unavailable when no signing key exists", async () => {
    const { CliSession } = await import("../../src/cli/cli-session");
    const cli = CliSession.create({
      baseUrl: "https://api.aomi.dev",
      app: "default",
      secrets: {},
    });
    const session = cli.createClientSession();
    session.actions.ingest(action("action-1"));

    expect(session.actions.canExecute("action-1")).toBe(false);
    session.close();
  });
});
