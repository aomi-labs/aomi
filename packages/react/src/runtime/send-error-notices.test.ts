import { describe, expect, it } from "vitest";
import { AgentApiError } from "@aomi-labs/client";
import { describeSendFailure } from "./send-error-notices";

const apiError = (status: number, code: string) =>
  new AgentApiError(status, code, `${code} from server`, false);

describe("send failure notices", () => {
  it.each([
    [404, "app_not_found", "App not found", /doesn't exist/],
    [409, "app_inactive", "App not active", /isn't active yet/],
    [401, "app_key_required", "App key required", /private.*App key/],
    [
      403,
      "app_key_not_scoped",
      "App key not valid for this App",
      /doesn't grant access/,
    ],
  ])(
    "explains %s %s and keeps the chat pinned",
    (status, code, title, message) => {
      const failure = describeSendFailure(apiError(status, code), false);
      expect(failure.notice).toEqual({
        type: "error",
        title,
        message: expect.stringMatching(message),
      });
      expect(failure.forgetThread).toBeFalsy();
    },
  );

  it.each([
    [
      apiError(404, "session_not_found"),
      false,
      "Conversation unavailable",
      true,
    ],
    [apiError(409, "execution_conflict"), false, "Account busy", undefined],
    [new Error("socket closed"), true, "Unable to confirm message", undefined],
    [apiError(400, "invalid_request"), false, "Message not sent", undefined],
  ] as const)(
    "names %s (start uncertain: %s) as %s",
    (error, startUncertain, title, forgetThread) => {
      const failure = describeSendFailure(error, startUncertain);
      expect(failure.notice.title).toBe(title);
      expect(failure.forgetThread).toBe(forgetThread);
    },
  );

  it("shows the server message for other failures", () => {
    expect(
      describeSendFailure(apiError(400, "invalid_request"), false).notice
        .message,
    ).toBe("invalid_request from server");
  });

  it("routes running out of funds to the payment modal", () => {
    expect(
      describeSendFailure(apiError(402, "payment_required"), false).notice,
    ).toEqual({
      type: "error",
      kind: "payment_required",
      title: "You're out of funds",
    });
  });
});
