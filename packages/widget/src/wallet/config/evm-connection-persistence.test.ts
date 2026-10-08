import { describe, expect, it } from "vitest";
import { resolveEvmConnectionPersistence } from "./evm-connection-persistence";

describe("external EVM connection persistence", () => {
  it("persists connections by default", () => {
    expect(resolveEvmConnectionPersistence(undefined)).toBe(true);
    expect(resolveEvmConnectionPersistence({})).toBe(true);
  });

  it("allows hosts to opt out explicitly", () => {
    expect(resolveEvmConnectionPersistence({ persistConnections: false })).toBe(
      false,
    );
  });
});
