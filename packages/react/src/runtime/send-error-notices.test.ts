import { describe, expect, it } from "vitest";
import { AgentApiError, GuestSignInError } from "@aomi-labs/client";
import { describeSendFailure } from "./send-error-notices";

const apiError = (status: number, code: string) =>
  new AgentApiError(status, code, `${code} from server`, false);

describe("send failure notices", () => {
  it.each([
    [404, "app_not_found", "App not found", /doesn't exist/],
    [409, "app_inactive", "App not active", /isn't active yet/],
    [401, "app_key_required", "App key required", /private.*App key.*builder/],
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

  it("does not ask the user to pay when the App's builder is in debt", () => {
    const { notice } = describeSendFailure(
      apiError(402, "builder_debt"),
      false,
    );
    expect(notice.kind).toBeUndefined();
    expect(notice).toMatchObject({
      type: "error",
      title: "App paused",
      message: expect.stringMatching(
        /temporarily unavailable because its builder needs to add funds/,
      ),
    });
  });

  it.each(["model_not_sponsored", "sponsorship_unavailable"])(
    "keeps the payment modal for the user's own credits, not a 402 %s",
    (code) => {
      const { notice } = describeSendFailure(apiError(402, code), false);
      expect(notice.kind).toBeUndefined();
      expect(notice.title).toBe("App unavailable");
    },
  );

  it("names a guest sign-in rate limit with the server's wait", () => {
    const limited = (retryAfter?: string) =>
      new GuestSignInError(
        new Response(null, {
          status: 429,
          headers: retryAfter ? { "retry-after": retryAfter } : {},
        }),
        "Aomi guest sign-in failed with HTTP 429",
      );
    expect(describeSendFailure(limited("30"), false).notice).toEqual({
      type: "error",
      title: "Too many requests",
      message: expect.stringMatching(/again in 30 seconds\.$/),
    });
    expect(describeSendFailure(limited("3600"), false).notice.message).toMatch(
      /again in about 60 minutes\.$/,
    );
    expect(describeSendFailure(limited(), false).notice.message).toMatch(
      /again in a little while\.$/,
    );
  });

  it("names the App ID when a Direct chat is refused", () => {
    const refused = apiError(403, "forbidden");
    expect(describeSendFailure(refused, false, true).notice).toMatchObject({
      title: "App not available",
      message: expect.stringMatching(/App ID isn't available/),
    });
    expect(describeSendFailure(refused, false).notice.title).toBe(
      "Message not sent",
    );
  });
});
