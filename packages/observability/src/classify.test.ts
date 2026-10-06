import { describe, expect, it } from "vitest";

import { classifyFailure } from "../src/classify";
import type { IdentifiedFailure } from "../src/failure";

const context = { routeFamily: "/api/test", operation: "test.failure" };

function failure(
  input: Partial<IdentifiedFailure> & Pick<IdentifiedFailure, "origin">,
): IdentifiedFailure {
  return {
    error: new Error("failure"),
    context,
    handled: true,
    ...input,
  };
}

describe("classifyFailure", () => {
  it("creates Issues for local and upstream-request failures", () => {
    expect(classifyFailure(failure({ origin: "local" }))).toMatchObject({
      action: "issue",
      reason: "local_exception",
      responseStatus: 500,
      responseError: "internal_error",
    });
    expect(
      classifyFailure(
        failure({ origin: "upstream_request", upstream: "rust" }),
      ),
    ).toMatchObject({
      action: "issue",
      reason: "upstream_request_failed",
      responseStatus: 502,
      responseError: "upstream_unavailable",
    });
  });

  it("logs upstream 5xx responses without creating a duplicate Issue", () => {
    expect(
      classifyFailure(
        failure({
          origin: "upstream_response",
          upstream: "rust",
          upstreamStatus: 503,
        }),
      ),
    ).toMatchObject({ action: "log", responseStatus: 503 });
  });

  it.each([401, 403])(
    "creates an Issue when upstream %s rejects a service credential",
    (upstreamStatus) => {
      expect(
        classifyFailure(
          failure({
            origin: "upstream_response",
            upstream: "rust",
            upstreamStatus,
            credential: "service",
          }),
        ),
      ).toMatchObject({
        action: "issue",
        reason: "service_credential_rejected",
        responseStatus: 500,
      });
    },
  );

  it.each([400, 401, 403, 404, 409, 429])(
    "ignores an ordinary upstream %s",
    (upstreamStatus) => {
      expect(
        classifyFailure(
          failure({
            origin: "upstream_response",
            upstream: "rust",
            upstreamStatus,
            credential: "user",
          }),
        ).action,
      ).toBe("ignore");
    },
  );

  it.each([401, 403])(
    "keeps upstream %s without a credential owner as an expected rejection",
    (upstreamStatus) => {
      expect(
        classifyFailure(
          failure({
            origin: "upstream_response",
            upstream: "rust",
            upstreamStatus,
          }),
        ),
      ).toMatchObject({ action: "ignore", reason: "expected" });
    },
  );

  it("fails malformed upstream statuses toward an Issue", () => {
    expect(
      classifyFailure(
        failure({
          origin: "upstream_response",
          upstream: "rust",
          upstreamStatus: 999,
        }),
      ),
    ).toMatchObject({ action: "issue", reason: "invalid_upstream_status" });
  });

  it("keeps source-owned safe response hints", () => {
    expect(
      classifyFailure(
        failure({
          origin: "expected",
          responseHint: { status: 409, error: "deployment_conflict" },
        }),
      ),
    ).toMatchObject({
      action: "ignore",
      responseStatus: 409,
      responseError: "deployment_conflict",
    });
  });
});
