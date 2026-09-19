import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackendError, DeployError } from "@aomi-labs/deploy";
import { RequiredSecretsCheckError } from "@aomi-labs/deploy/bff";

const sentry = vi.hoisted(() => ({
  captureException: vi.fn(),
  captureRequestError: vi.fn(),
  init: vi.fn(),
  logger: { error: vi.fn() },
  requestDataIntegration: vi.fn(() => ({ name: "RequestData" })),
  scope: { setLevel: vi.fn(), setTags: vi.fn() },
  withIsolationScope: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: sentry.captureException,
  captureRequestError: sentry.captureRequestError,
  init: sentry.init,
  logger: sentry.logger,
  requestDataIntegration: sentry.requestDataIntegration,
  withIsolationScope: sentry.withIsolationScope,
}));

import { createFailurePipeline } from "../src/pipeline";
import { getBffSentryRelease, initBffSentry } from "../src/route";

const context = {
  routeFamily: "/api/bff/launch/deploy",
  operation: "launch.deploy",
  method: "POST",
};

describe("three-layer failure pipeline", () => {
  beforeEach(() => {
    sentry.withIsolationScope.mockImplementation((callback) =>
      callback(sentry.scope),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("identifies, classifies, and routes a service-credential rejection once", async () => {
    const error = new BackendError(
      "deploy",
      401,
      "private message",
      "private body",
    );
    const result = createFailurePipeline("portal-bff").handle({
      source: "launch",
      error,
      context,
    });

    expect(result).toMatchObject({
      action: "issue",
      reason: "service_credential_rejected",
      responseStatus: 401,
      responseError: "private message",
      upstream: "rust",
      upstreamStatus: 401,
    });
    await expect(result.response.json()).resolves.toEqual({
      error: "private message",
    });
    expect(sentry.captureException).toHaveBeenCalledOnce();
    expect(sentry.captureException).toHaveBeenCalledWith(error);
  });

  it("preserves an expected launch response and routes it nowhere", async () => {
    const result = createFailurePipeline("portal-bff").handle({
      source: "launch",
      error: new DeployError("INVALID_REQUEST", "invalid release"),
      context,
    });

    expect(result).toMatchObject({ action: "ignore", responseStatus: 400 });
    await expect(result.response.json()).resolves.toEqual({
      error: "invalid release",
    });
    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(sentry.logger.error).not.toHaveBeenCalled();
  });

  it("prints an opt-in expected diagnostic only to the development console", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = createFailurePipeline("portal-bff").handle({
      source: "expected",
      response: { status: 401, error: "invalid_wallet_signature" },
      context: {
        routeFamily: "/v1/account/wallets/link",
        operation: "wallet.link",
        method: "POST",
      },
      localDiagnostic: {
        kind: "wallet.signature_mismatch",
        attributes: {
          expected_address: "0x1234...5678",
          recovered_address: null,
          chain_id: 1,
          message_matches: false,
        },
      },
    });

    expect(result.action).toBe("ignore");
    await expect(result.response.json()).resolves.toEqual({
      error: "invalid_wallet_signature",
    });
    expect(consoleWarn).toHaveBeenCalledWith(
      "bff.expected_failure",
      expect.objectContaining({
        service: "portal-bff",
        route_family: "/v1/account/wallets/link",
        operation: "wallet.link",
        diagnostic: "wallet.signature_mismatch",
        expected_address: "0x1234...5678",
        recovered_address: null,
      }),
    );
    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(sentry.logger.error).not.toHaveBeenCalled();
  });

  it("keeps an opt-in expected diagnostic silent outside development", () => {
    vi.stubEnv("NODE_ENV", "production");
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    createFailurePipeline("portal-bff").handle({
      source: "expected",
      response: { status: 400, error: "invalid_request" },
      context,
      localDiagnostic: { kind: "request.invalid" },
    });

    expect(consoleWarn).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(sentry.logger.error).not.toHaveBeenCalled();
  });

  it("drops an invalid local diagnostic without changing the response", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = createFailurePipeline("portal-bff").handle({
      source: "expected",
      response: { status: 400, error: "invalid_request" },
      context,
      localDiagnostic: {
        kind: "request.invalid",
        attributes: { detail: "x".repeat(161) },
      },
    });

    await expect(result.response.json()).resolves.toEqual({
      error: "invalid_request",
    });
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(sentry.logger.error).not.toHaveBeenCalled();
  });

  it("does not let a broken expected-failure console change routing", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.spyOn(console, "warn").mockImplementation(() => {
      throw new Error("console unavailable");
    });

    expect(() =>
      createFailurePipeline("portal-bff").handle({
        source: "expected",
        response: { status: 400, error: "invalid_request" },
        context,
        localDiagnostic: { kind: "request.invalid" },
      }),
    ).not.toThrow();
  });

  it("routes an upstream 5xx to one structured log", async () => {
    const result = createFailurePipeline("build-bff").handle({
      source: "launch",
      error: new BackendError("deploy", 503, "private", "private body"),
      context,
    });

    expect(result.action).toBe("log");
    await expect(result.response.json()).resolves.toEqual({
      error: "private",
    });
    expect(sentry.logger.error).toHaveBeenCalledOnce();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it("captures the original network cause", () => {
    const cause = new Error("socket refused");
    createFailurePipeline("portal-bff").handle({
      source: "launch",
      error: new BackendError("deploy", 0, "request failed", undefined, {
        cause,
      }),
      context,
    });
    expect(sentry.captureException).toHaveBeenCalledWith(cause);
  });

  it("keeps proxy response-transform failures local to the BFF", () => {
    const error = new Error("transform failed");
    const result = createFailurePipeline("portal-bff").handle({
      source: "proxy",
      failure: {
        kind: "response_transform",
        error,
        method: "GET",
        pathname: "/api/account",
        responseStatus: 502,
      },
    });

    expect(result).toMatchObject({
      action: "issue",
      reason: "local_exception",
      responseStatus: 502,
      responseError: "upstream_unavailable",
    });
    expect(result).not.toHaveProperty("upstream");
    expect(sentry.captureException).toHaveBeenCalledWith(error);
  });

  it("recognizes required-secret failures across deploy package entrypoints", () => {
    const error = new RequiredSecretsCheckError({
      upstream: "github",
      upstreamStatus: 503,
    });
    const result = createFailurePipeline("portal-bff").handle({
      source: "launch",
      error,
      context,
    });

    expect(result).toMatchObject({
      action: "log",
      upstream: "github",
      upstreamStatus: 503,
      responseStatus: 503,
      responseError: "Unable to verify required secrets. Try again.",
    });
    expect(sentry.logger.error).toHaveBeenCalledOnce();
  });

  it("prints the original Issue and safe context in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const error = new Error("database connection refused");

    createFailurePipeline("portal-bff").handle({
      source: "local",
      error,
      context: {
        routeFamily: "/api/account/private-user-id",
        operation: "account.lookup",
        method: "GET",
      },
    });

    expect(consoleError).toHaveBeenCalledWith(
      "bff.exception",
      expect.objectContaining({
        service: "portal-bff",
        route_family: "/api/account/:param",
        operation: "account.lookup",
      }),
      error,
    );
  });

  it("uses Sentry's request-error adapter for uncaught framework errors", () => {
    const error = new Error("uncaught");
    const request = { path: "/api/private", method: "GET", headers: {} };
    const errorContext = {
      routerKind: "App Router",
      routePath: "/api/[id]",
      routeType: "route",
    };

    createFailurePipeline("build-bff").handle({
      source: "uncaught",
      error,
      request,
      errorContext,
      context: {
        routeFamily: errorContext.routePath,
        operation: "next.request_error",
        method: request.method,
      },
    });

    expect(sentry.captureRequestError).toHaveBeenCalledWith(
      error,
      request,
      errorContext,
    );
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it("does not let a broken local console change routing", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("console unavailable");
    });
    expect(() =>
      createFailurePipeline("build-bff").handle({
        source: "local",
        error: new Error("original"),
        context,
      }),
    ).not.toThrow();
    expect(sentry.captureException).toHaveBeenCalledOnce();
  });

  it.each([
    ["issue", { source: "local" as const, error: new Error("original") }],
    [
      "log",
      {
        source: "upstream_response" as const,
        upstream: "rust" as const,
        status: 503,
      },
    ],
  ])(
    "does not let broken Sentry delivery replace an %s response",
    (_, input) => {
      sentry.withIsolationScope.mockImplementationOnce(() => {
        throw new Error("Sentry unavailable");
      });

      expect(() =>
        createFailurePipeline("portal-bff").handle({ ...input, context }),
      ).not.toThrow();
    },
  );

  it.each([101, 204, 205, 304])(
    "normalizes invalid response status %i without throwing",
    async (status) => {
      const result = createFailurePipeline("portal-bff").handle({
        source: "expected",
        response: { status, error: "invalid_request" },
        context,
      });

      expect(result.responseStatus).toBe(500);
      expect(result.response.status).toBe(500);
      await expect(result.response.json()).resolves.toEqual({
        error: "invalid_request",
      });
    },
  );

  it("falls back safely when source identification throws", async () => {
    const identificationError = new Error("broken deploy error shape");
    const error = Object.create(null, {
      code: {
        get() {
          throw identificationError;
        },
      },
    });

    const result = createFailurePipeline("portal-bff").handle({
      source: "launch",
      error,
      context,
    });

    expect(result).toMatchObject({
      action: "issue",
      responseStatus: 500,
      responseError: "internal_error",
    });
    await expect(result.response.json()).resolves.toEqual({
      error: "internal_error",
    });
    expect(sentry.captureException).toHaveBeenCalledWith(identificationError);
  });

  it("captures invalid context under a fixed safe fallback", () => {
    const error = new Error("database unavailable");

    createFailurePipeline("portal-bff").handle({
      source: "local",
      error,
      context: {
        routeFamily: "private route with spaces",
        operation: "INVALID OPERATION",
      },
    });

    expect(sentry.scope.setTags).toHaveBeenCalledWith(
      expect.objectContaining({
        route_family: "/observability",
        operation: "observability.invalid_context",
      }),
    );
    expect(sentry.captureException).toHaveBeenCalledWith(error);
  });

  it("accepts the root route family", () => {
    createFailurePipeline("portal-bff").handle({
      source: "local",
      error: new Error("root failed"),
      context: { routeFamily: "/", operation: "root.request" },
    });

    expect(sentry.scope.setTags).toHaveBeenCalledWith(
      expect.objectContaining({ route_family: "/" }),
    );
  });

  it("keeps the 499/500 upstream boundary exact", () => {
    const pipeline = createFailurePipeline("portal-bff");
    const rejected = pipeline.handle({
      source: "upstream_response",
      upstream: "rust",
      status: 499,
      context,
    });
    const failed = pipeline.handle({
      source: "upstream_response",
      upstream: "rust",
      status: 500,
      context,
    });

    expect(rejected.action).toBe("ignore");
    expect(failed.action).toBe("log");
  });

  it("writes a sanitized production fallback when Sentry is not initialized", () => {
    vi.stubEnv("NODE_ENV", "production");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const error = new Error("private database detail");

    createFailurePipeline("portal-bff").handle({
      source: "local",
      error,
      context,
    });

    expect(consoleError).toHaveBeenCalledWith(
      "bff.exception",
      expect.objectContaining({ service: "portal-bff" }),
    );
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      error,
    );
  });
});

describe("initBffSentry", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("is disabled outside a complete production configuration", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SENTRY_ENABLED", "1");
    vi.stubEnv("SENTRY_DSN", "https://public@sentry.example/1");
    vi.stubEnv("SENTRY_ENVIRONMENT", "staging");
    expect(initBffSentry({ service: "portal-bff" })).toBe(false);
    expect(sentry.init).not.toHaveBeenCalled();
  });

  it("initializes errors and logs with privacy defaults", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SENTRY_ENABLED", "1");
    vi.stubEnv("SENTRY_DSN", "https://public@sentry.example/1");
    vi.stubEnv("SENTRY_ENVIRONMENT", "staging");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abcdef0123456789");

    expect(initBffSentry({ service: "build-bff" })).toBe(true);
    expect(getBffSentryRelease("build-bff")).toBe("build-bff@abcdef0123456789");
    expect(sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: "staging",
        enableLogs: true,
        tracesSampleRate: 0,
        sendDefaultPii: false,
      }),
    );
    const options = sentry.init.mock.calls[0]?.[0] as {
      integrations: (
        integrations: Array<{ name: string }>,
      ) => Array<{ name: string }>;
    };
    expect(
      options
        .integrations([
          { name: "OnUncaughtException" },
          { name: "OnUnhandledRejection" },
          { name: "CaptureConsole" },
          { name: "Http" },
        ])
        .map(({ name }) => name),
    ).toEqual(["Http", "RequestData"]);
  });

  it("fails closed when SDK initialization throws", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SENTRY_ENABLED", "1");
    vi.stubEnv("SENTRY_DSN", "https://public@sentry.example/1");
    vi.stubEnv("SENTRY_ENVIRONMENT", "staging");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abcdef0123456789");
    sentry.init.mockImplementationOnce(() => {
      throw new Error("Sentry unavailable");
    });

    expect(initBffSentry({ service: "portal-bff" })).toBe(false);
  });
});
