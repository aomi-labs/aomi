import { describe, expect, it } from "vitest";

import { explainError } from "./explain-error";

describe("explainError", () => {
  it("treats a declined signature as a choice, not a fault", () => {
    for (const raw of [
      "User rejected the request",
      "user denied transaction signature",
      "MetaMask Tx Signature: User denied (4001)",
    ]) {
      expect(explainError(new Error(raw))).toMatch(/declined/i);
    }
  });

  it("maps the authorization codes the backend actually returns", () => {
    expect(explainError(new Error("missing_delegated_account"))).toMatch(
      /server signing is not enabled/i,
    );
    expect(explainError(new Error("wrong_signer"))).toMatch(/did not match/i);
    expect(explainError(new Error("stale_permit"))).toMatch(/try again/i);
    expect(explainError(new Error("unknown_wallet"))).toMatch(/isn't linked/i);
  });

  it("unwraps a JSON error body", () => {
    expect(explainError(new Error('{"error":"wrong_signer"}'))).toMatch(
      /did not match/i,
    );
  });

  it("matches prefixed codes that carry an upstream suffix", () => {
    expect(
      explainError(
        new Error("telegram_privy_identity_token_refresh_failed_network"),
      ),
    ).toMatch(/expired/i);
    expect(
      explainError(new Error("telegram_privy_exchange_failed_500_internal")),
    ).toMatch(/could not verify/i);
    expect(
      explainError(new Error("delegation_signer_rejected_already installed")),
    ).toMatch(/declined the signing permission/i);
    expect(explainError(new Error("bad_permit: expiry too far"))).toMatch(
      /malformed/i,
    );
  });

  it("explains launch failures as something the user can do", () => {
    expect(explainError(new Error("open_from_telegram"))).toMatch(
      /open this page from telegram/i,
    );
    expect(explainError(new Error("expired"))).toMatch(/reopen/i);
    expect(explainError(new Error("bot_not_allowed"))).toMatch(
      /not authorized/i,
    );
  });

  it("never renders an unknown server payload verbatim", () => {
    const raw = '{"trace":"pg: connection refused at 10.0.0.4:5432"}';
    const explained = explainError(new Error(raw));
    expect(explained).toBe("Something went wrong. Try again.");
    expect(explained).not.toContain("10.0.0.4");
  });

  it("handles a non-Error cause", () => {
    expect(explainError(undefined)).toBe("Something went wrong. Try again.");
  });
});
