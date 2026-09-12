import { describe, expect, it } from "vitest";
import { appendCapabilityHints } from "../capability-hints";

describe("selected app delegation", () => {
  it.each([
    ["application:123", '{"application_id":123}'],
    ["name:cambrian", '{"app":"cambrian"}'],
  ])("gives Auto a concrete task target for %s", (id, target) => {
    const message = appendCapabilityHints("▦ Cambrian list ur tools", {
      capabilities: [{ kind: "app", id }],
    });
    expect(message).toContain(`task target: ${target}`);
    expect(message).toContain("including requests to list its tools");
    expect(message).toContain(
      "Do not infer app availability from your own tool list",
    );
  });

  it("does not turn malformed application selectors into task targets", () => {
    for (const id of [
      "application:0",
      "application:-1",
      "application:abc",
      "application:1e2",
      "application:0x10",
      "application:9007199254740992",
    ]) {
      expect(
        appendCapabilityHints("hello", {
          capabilities: [{ kind: "app", id }],
        }),
      ).not.toContain("task target:");
    }
  });
});

describe("app selection and removal guidance", () => {
  it("includes removal guidance even when no chips remain", () => {
    const message = appendCapabilityHints("continue", {
      capabilities: [],
      removedApps: [
        { kind: "app", id: "application:2937773", label: "Cambrian" },
      ],
    });
    expect(message).toContain(
      "User removed app selection: Cambrian (application:2937773)",
    );
    expect(message).toContain("only to this turn");
    expect(message).not.toContain("Selected app task target");
  });
  it("prioritizes reselection and keeps irrelevant work optional", () => {
    const app = { kind: "app", id: "application:2937773", label: "Cambrian" };
    const message = appendCapabilityHints("search USDC", {
      capabilities: [app],
      removedApps: [app],
    });
    expect(message).toContain("User selected app: Cambrian");
    expect(message).toContain("Use this app for relevant work");
    expect(message).not.toContain("User removed app selection");
    expect(message).toContain(
      "offer alternatives without silently substituting",
    );
  });
});
