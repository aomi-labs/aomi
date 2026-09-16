import { describe, expect, it } from "vitest";

import {
  resolveAction,
  resolveFailure,
  resolveHeadline,
  resolveStageStates,
  type CeremonyInput,
} from "./ceremony";

function ceremony(overrides: Partial<CeremonyInput> = {}): CeremonyInput {
  return {
    launch: { status: "ready", error: null },
    auth: { phase: "ready", error: null, readyForExchange: true },
    account: { status: "ready", error: null },
    delegation: { status: "ready", error: null },
    permission: { status: "idle", error: null, mode: null },
    ...overrides,
  };
}

describe("resolveFailure", () => {
  it("returns nothing while the ceremony is healthy", () => {
    expect(resolveFailure(ceremony())).toBeNull();
  });

  it("lets the deepest failing stage win", () => {
    // Every stage failing at once: the permit is the one the user was doing.
    const failure = resolveFailure(
      ceremony({
        launch: { status: "error", error: "open_from_telegram" },
        auth: { phase: "error", error: "auth_boom", readyForExchange: false },
        account: { status: "error", error: "account_boom" },
        delegation: { status: "error", error: "delegation_boom" },
        permission: { status: "error", error: "permit_boom", mode: null },
      }),
    );
    expect(failure).toEqual({ source: "permission", code: "permit_boom" });
  });

  it("orders the stages permission > delegation > account > auth > launch", () => {
    const order: [Partial<CeremonyInput>, string][] = [
      [{ permission: { status: "error", error: "a", mode: null } }, "a"],
      [{ delegation: { status: "error", error: "b" } }, "b"],
      [{ account: { status: "error", error: "c" } }, "c"],
      [{ auth: { phase: "error", error: "d", readyForExchange: false } }, "d"],
      [{ launch: { status: "error", error: "e" } }, "e"],
    ];
    // Applied cumulatively from the shallowest up, the deeper one must take over.
    let accumulated: Partial<CeremonyInput> = {};
    for (const [patch, code] of [...order].reverse()) {
      accumulated = { ...accumulated, ...patch };
      expect(resolveFailure(ceremony(accumulated))?.code).toBe(code);
    }
  });

  it("never lets a progress message outrank an error", () => {
    // The regression: an error raised early, with later stages still 'loading',
    // used to be painted over and read as a hang.
    const failure = resolveFailure(
      ceremony({
        auth: { phase: "error", error: "auth_boom", readyForExchange: false },
        account: { status: "loading", error: null },
      }),
    );
    expect(failure?.code).toBe("auth_boom");
    expect(resolveHeadline(ceremony())).not.toBe("");
  });

  it("names an auth failure even when the hook reported no code", () => {
    expect(
      resolveFailure(
        ceremony({
          auth: { phase: "error", error: null, readyForExchange: false },
        }),
      ),
    ).toEqual({ source: "auth", code: "telegram_custom_auth_failed" });
  });
});

describe("resolveStageStates", () => {
  it("walks the four stages forward", () => {
    expect(
      resolveStageStates(
        ceremony({
          auth: { phase: "validating", error: null, readyForExchange: false },
          account: { status: "disconnected", error: null },
          delegation: { status: "idle", error: null },
        }),
      ),
    ).toEqual({
      connect: "active",
      link: "pending",
      delegate: "pending",
      permit: "pending",
    });

    expect(
      resolveStageStates(
        ceremony({
          account: { status: "loading", error: null },
          delegation: { status: "idle", error: null },
        }),
      ).link,
    ).toBe("active");

    expect(
      resolveStageStates(
        ceremony({
          delegation: { status: "done", error: null },
          permission: { status: "done", error: null, mode: "server_auto" },
        }),
      ),
    ).toEqual({
      connect: "done",
      link: "done",
      delegate: "done",
      permit: "done",
    });
  });

  it("marks the failing stage, not the whole card", () => {
    const states = resolveStageStates(
      ceremony({ delegation: { status: "error", error: "boom" } }),
    );
    expect(states.delegate).toBe("error");
    expect(states.link).toBe("done");
  });
});

describe("resolveAction", () => {
  it("offers delegation before the permit", () => {
    expect(resolveAction(ceremony())).toBe("delegate");
  });

  it("offers the permit only once delegation is done", () => {
    expect(
      resolveAction(
        ceremony({
          delegation: { status: "done", error: null },
          permission: { status: "ready", error: null, mode: "server_auto" },
        }),
      ),
    ).toBe("sign");
  });

  it("offers nothing before the wallet is linked", () => {
    expect(
      resolveAction(ceremony({ account: { status: "loading", error: null } })),
    ).toBeNull();
  });

  it("offers nothing while a failure is on screen", () => {
    // The retry button is the only action during a failure.
    expect(
      resolveAction(
        ceremony({ permission: { status: "error", error: "x", mode: null } }),
      ),
    ).toBeNull();
  });
});

describe("resolveHeadline", () => {
  it("asks for delegation once the wallet is linked", () => {
    expect(resolveHeadline(ceremony())).toMatch(/needs permission to sign/i);
  });

  it("closes the loop when the permit is committed", () => {
    expect(
      resolveHeadline(
        ceremony({
          delegation: { status: "done", error: null },
          permission: { status: "done", error: null, mode: "server_auto" },
        }),
      ),
    ).toMatch(/all set/i);
  });

  it("speaks for each identity phase", () => {
    for (const [phase, pattern] of [
      ["choose", /choose how/i],
      ["email", /email/i],
      ["confirm", /confirm/i],
    ] as const) {
      expect(
        resolveHeadline(
          ceremony({
            auth: { phase, error: null, readyForExchange: false },
            account: { status: "disconnected", error: null },
          }),
        ),
      ).toMatch(pattern);
    }
  });
});
