import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";

import { DeployCliError, CliExit, fatal, mapDeployHttpError } from "./errors";

describe("DeployCliError — property-based", () => {
  const validCodes = [
    "AUTH_FAILED",
    "BACKEND_ERROR",
    "NOT_A_GIT_REPO",
    "VALIDATION_ERROR",
    "NETWORK_ERROR",
  ] as const;

  it("always has name 'DeployCliError' and stores errorCode", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...validCodes),
        fc.string({ minLength: 1, maxLength: 200 }),
        (code, message) => {
          const err = new DeployCliError(code, message);
          expect(err.name).toBe("DeployCliError");
          expect(err.errorCode).toBe(code);
          expect(err.message).toBe(message);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("is an instance of Error", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...validCodes),
        fc.string({ minLength: 1 }),
        (code, message) => {
          const err = new DeployCliError(code, message);
          expect(err).toBeInstanceOf(Error);
          expect(err).toBeInstanceOf(DeployCliError);
        },
      ),
      { numRuns: 20 },
    );
  });
});

describe("CliExit — property-based", () => {
  it("stores the exit code", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 255 }), (code) => {
        const err = new CliExit(code);
        expect(err.code).toBe(code);
      }),
      { numRuns: 50 },
    );
  });
});

describe("fatal — property-based", () => {
  it("throws a CliExit with code 1", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 500 }),
        (message) => {
          expect(() => fatal(message)).toThrow(CliExit);
          try {
            fatal(message);
          } catch (err) {
            expect((err as CliExit).code).toBe(1);
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});

describe("mapDeployHttpError — property-based", () => {
  it("Property 13: returns AUTH_FAILED for 401 and 403, not for other statuses", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 599 }),
        fc.string({ minLength: 1, maxLength: 200 }),
        (status, msg) => {
          const err = mapDeployHttpError(status, msg);
          expect(err).toBeInstanceOf(DeployCliError);
          if (status === 401 || status === 403) {
            expect(err.errorCode).toBe("AUTH_FAILED");
          } else {
            expect(err.errorCode).not.toBe("AUTH_FAILED");
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("Property 14: BACKEND_ERROR for non-auth HTTP errors", () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: 100, max: 599 })
          .filter((s) => s !== 401 && s !== 403),
        fc.string({ minLength: 1 }),
        (status, msg) => {
          const err = mapDeployHttpError(status, msg);
          expect(err.errorCode).toBe("BACKEND_ERROR");
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe("DeployCliError.fromHttpFailure", () => {
  const response = (status: number) => ({ status, statusText: "Status" });
  const body = (code: string) =>
    JSON.stringify({
      error: { code, message: "server text", retryable: false },
    });

  it.each([
    [401, "app_key_required", /private.*--api-key/],
    [403, "app_key_not_scoped", /doesn't grant access.*--api-key/],
    [409, "app_inactive", /isn't active yet/],
    [404, "app_not_found", /--app or --application-id/],
  ])(
    "explains %s %s instead of blaming the login session",
    (status, code, hint) => {
      const err = DeployCliError.fromHttpFailure(response(status), body(code));
      expect(err.errorCode).toBe("AUTH_FAILED");
      expect(err.message).toMatch(hint);
      expect(err.message).not.toMatch(/Session expired/);
    },
  );

  it("falls back to the login hint for other 401/403 responses", () => {
    for (const status of [401, 403]) {
      const err = DeployCliError.fromHttpFailure(
        response(status),
        JSON.stringify({ error: "unauthorized" }),
      );
      expect(err.errorCode).toBe("AUTH_FAILED");
      expect(err.message).toBe("Session expired; run `aomi account login`");
    }
  });

  it("reports backend messages from either error shape or a reason", () => {
    expect(
      DeployCliError.fromHttpFailure(
        response(500),
        JSON.stringify({ error: "boom" }),
      ).message,
    ).toBe("boom");
    expect(
      DeployCliError.fromHttpFailure(response(422), body("invalid_manifest"))
        .message,
    ).toBe("server text");
    expect(
      DeployCliError.fromHttpFailure(
        response(400),
        JSON.stringify({ reason: "nope" }),
      ).message,
    ).toBe("nope");
    const html = DeployCliError.fromHttpFailure(
      response(502),
      "<html>bad gateway</html>",
    );
    expect(html.errorCode).toBe("BACKEND_ERROR");
    expect(html.message).toBe("502 Status");
  });
});
