// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { setAccountDiagnosticObserver } from "../observability";
import { verifySiweMessage } from "./siwe";

describe("SIWE diagnostics", () => {
  afterEach(() => setAccountDiagnosticObserver(undefined));

  it("preserves bounded mismatch context without the message or signature", async () => {
    const observer = vi.fn();
    setAccountDiagnosticObserver(observer);

    await expect(
      verifySiweMessage({
        message: "example.com wants you to sign in",
        signature: "0x00",
        address: "0x1111111111111111111111111111111111111111",
      }),
    ).resolves.toBe(false);

    expect(observer).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "siwe.signature_mismatch",
        attributes: expect.objectContaining({
          reason: "missing_chain",
          expected_address: "0x1111…1111",
          recovered_address: null,
          chain_id: null,
        }),
        context: {
          routeFamily: "/api/auth/[...all]",
          operation: "account.siwe_verify",
          method: "POST",
        },
        response: { status: 401, error: "invalid_siwe_signature" },
      }),
    );
    const attributes = observer.mock.calls[0]?.[0]?.attributes;
    expect(attributes).not.toHaveProperty("message");
    expect(attributes).not.toHaveProperty("signature");
  });
});
