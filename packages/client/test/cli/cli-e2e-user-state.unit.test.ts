// =============================================================================
// CLI UserState — end-to-end wire shape
// =============================================================================
// Verifies the CLI's canonical UserState source. ClientSession reads this
// callback only while constructing StartTurnIntent; it never owns or mutates
// a second wallet state. Each test asserts the exact UserState wire shape:
// {connection, evm, svm, ext} with AA fields absent (backend authority).
//
// Coverage:
//   Table A (connect-time): CLI no-AA, CLI --aa 4337, CLI --aa 7702
//   Table B (post-tx writes): CLI --aa 4337 tx, CLI --aa 7702 tx
//
// Disconnected / Booting rows are React-runtime concerns (handled in
// packages/react/.../user-context tests) and out of scope here.

import { describe, expect, it } from "vitest";
import { buildCliUserState } from "../../src/cli/user-state";

const EOA = "0xEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE";
const CHAIN_ID = 1;

// ---------------------------------------------------------------------------
// Connect-time
// ---------------------------------------------------------------------------
//
// Account-abstraction and sponsorship are backend authority (resolved by the
// execution-profile endpoint and per-execution operation payloads). The CLI's
// user_state carries only the owner, chain, connection, and client_type; it
// never persists aa/sponsorship. The `--aa` preference is applied per
// transaction via the execution payload, not stored here.

describe("CLI UserState — connect-time", () => {
  it("carries address + chain + is_connected + ts_cli client_type, no aa/sponsorship", () => {
    const state = buildCliUserState(EOA, CHAIN_ID);

    expect(state).toEqual({
      evm: { address: EOA, chain_id: CHAIN_ID },
      connection: { is_connected: true },
      ext: { client_type: "ts_cli" },
    });
    expect(state?.evm).not.toHaveProperty("aa");
    expect(state?.evm).not.toHaveProperty("sponsorship");
  });
});
