import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({
  captureException: vi.fn(),
  flush: vi.fn().mockResolvedValue(true),
  logger: { error: vi.fn() },
  requestDataIntegration: vi.fn(() => ({ name: "RequestData" })),
  scope: { setLevel: vi.fn(), setTags: vi.fn() },
  withIsolationScope: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: sentry.captureException,
  flush: sentry.flush,
  logger: sentry.logger,
  requestDataIntegration: sentry.requestDataIntegration,
  withIsolationScope: sentry.withIsolationScope,
}));

import {
  isBffSentrySmokeRequestAllowed,
  runBffSentrySmoke,
} from "../src/smoke";

describe("BFF Sentry smoke helper", () => {
  beforeEach(() => {
    sentry.flush.mockResolvedValue(true);
    sentry.withIsolationScope.mockImplementation((callback) =>
      callback(sentry.scope),
    );
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SENTRY_ENABLED", "1");
    vi.stubEnv("SENTRY_DSN", "https://public@sentry.example/1");
    vi.stubEnv("SENTRY_ENVIRONMENT", "staging");
    vi.stubEnv("SENTRY_SMOKE_ENABLED", "1");
    vi.stubEnv("SENTRY_SMOKE_SECRET", "correct-secret");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abcdef0123456789");
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("rejects disabled, production, local, and incorrectly authenticated requests", () => {
    expect(isBffSentrySmokeRequestAllowed("wrong-secret")).toBe(false);

    vi.stubEnv("SENTRY_ENVIRONMENT", "production");
    expect(isBffSentrySmokeRequestAllowed("correct-secret")).toBe(false);

    vi.stubEnv("SENTRY_ENVIRONMENT", "staging");
    vi.stubEnv("NODE_ENV", "test");
    expect(isBffSentrySmokeRequestAllowed("correct-secret")).toBe(false);

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SENTRY_SMOKE_ENABLED", "0");
    expect(isBffSentrySmokeRequestAllowed("correct-secret")).toBe(false);

    vi.stubEnv("SENTRY_SMOKE_ENABLED", "1");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    expect(isBffSentrySmokeRequestAllowed("correct-secret")).toBe(false);
  });

  it("emits one fixed Issue and one fixed log, then performs a bounded flush", async () => {
    await expect(
      runBffSentrySmoke({
        service: "portal-bff",
        providedSecret: "correct-secret",
        flushTimeoutMs: 1_500,
      }),
    ).resolves.toBe(true);

    expect(sentry.captureException).toHaveBeenCalledOnce();
    const captured = sentry.captureException.mock.calls[0]?.[0];
    expect(captured).toBeInstanceOf(Error);
    expect(captured.message).toBe("Aomi BFF Sentry smoke test");
    expect(sentry.logger.error).toHaveBeenCalledOnce();
    expect(sentry.logger.error).toHaveBeenCalledWith(
      "bff.smoke_test",
      expect.objectContaining({
        service: "portal-bff",
        smoke_test: true,
      }),
      { scope: sentry.scope },
    );
    expect(sentry.flush).toHaveBeenCalledWith(1_500);
  });

  it("does not emit telemetry for a rejected request", async () => {
    await expect(
      runBffSentrySmoke({
        service: "portal-bff",
        providedSecret: "wrong-secret",
      }),
    ).resolves.toBe(false);

    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(sentry.logger.error).not.toHaveBeenCalled();
    expect(sentry.flush).not.toHaveBeenCalled();

    await expect(
      runBffSentrySmoke({
        service: "invalid",
        providedSecret: "correct-secret",
      } as never),
    ).resolves.toBe(false);
  });

  it("reports failure when the bounded flush cannot deliver telemetry", async () => {
    sentry.flush.mockResolvedValueOnce(false);

    await expect(
      runBffSentrySmoke({
        service: "build-bff",
        providedSecret: "correct-secret",
      }),
    ).resolves.toBe(false);

    expect(sentry.captureException).toHaveBeenCalledOnce();
    expect(sentry.logger.error).toHaveBeenCalledOnce();
  });

  it("reports failure instead of throwing when Sentry delivery fails", async () => {
    sentry.withIsolationScope.mockImplementationOnce((callback) =>
      callback(sentry.scope),
    );
    sentry.withIsolationScope.mockImplementationOnce(() => {
      throw new Error("Sentry unavailable");
    });

    await expect(
      runBffSentrySmoke({
        service: "portal-bff",
        providedSecret: "correct-secret",
      }),
    ).resolves.toBe(false);
  });
});
