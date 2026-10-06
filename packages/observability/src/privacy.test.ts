import { describe, expect, it } from "vitest";

import {
  normalizeRequestPath,
  scrubSentryEvent,
  scrubSentryLog,
} from "../src/privacy";

describe("normalizeRequestPath", () => {
  it("removes query values, fragments, identifiers, and unknown segments", () => {
    expect(
      normalizeRequestPath(
        "https://portal.aomi.dev/api/threads/89d96b41-cafb-4d6e-8516-70db2780f4a1?token=secret#prompt",
      ),
    ).toBe("/api/threads/:param");
    expect(normalizeRequestPath("/api/bff/auth/[...all]")).toBe(
      "/api/bff/auth/:catchall",
    );
    expect(normalizeRequestPath("/api/bff/auth/:catchall")).toBe(
      "/api/bff/auth/:catchall",
    );
  });
});

describe("scrubSentryEvent", () => {
  it("retains a diagnosable stack and only allowlisted operational data", () => {
    const event = scrubSentryEvent({
      event_id: "a".repeat(32),
      timestamp: 123,
      level: "warning",
      platform: "node",
      release: "portal-bff@abcdef0",
      environment: "staging",
      transaction: "/api/threads/private-thread?oauth_code=secret",
      message: "prompt and generated source",
      logentry: { message: "Bearer secret" },
      request: {
        url: "https://portal.aomi.dev/api?code=oauth-code",
        method: "POST",
        headers: { authorization: "Bearer token", cookie: "session=secret" },
        cookies: { session: "secret" },
        data: "wallet signature and MCP arguments",
      },
      user: {
        id: "canonical-user",
        email: "person@example.com",
        ip_address: "127.0.0.1",
      },
      extra: {
        oauthChallenge: "challenge",
        oauthClientId: "client-id",
        oauthState: "state",
        oauthVerifier: "verifier",
        prompt: "private prompt",
        generatedSource: "private source",
        buildArtifact: "private artifact",
        buildOutput: "private output",
        backendBody: "private response",
        transactionData: "private transaction",
        x402Proof: "private payment proof",
        walletAddress: "0x123",
        walletMessage: "private message",
        walletNonce: "private nonce",
        walletSignature: "private signature",
        mcpArguments: "private arguments",
        mcpProgram: "private program",
        mcpResult: "private result",
        serviceCredential: "secret",
      },
      breadcrumbs: [
        {
          message: "build artifact",
          data: { walletAddress: "0x123", signature: "signed" },
        },
      ],
      contexts: {
        oauth: {
          code: "code",
          state: "state",
          verifier: "verifier",
          redirectUri: "https://private.example",
        },
        response: {
          headers: { "set-cookie": "secret" },
          body: "upstream body",
        },
      },
      tags: {
        service: "portal-bff",
        route_family: "/api/threads/[id]",
        operation: "thread_proxy",
        method: "POST",
        handled: true,
        wallet: "0x123",
        repository: "private-repository",
      },
      exception: {
        values: [
          {
            type: "DatabaseError",
            value: "failed with password secret and user prompt",
            mechanism: {
              type: "generic",
              handled: true,
              data: { request: "private payload" },
            },
            stacktrace: {
              frames: [
                {
                  filename: "/var/task/.next/server/app.js?token=secret",
                  abs_path: "/var/task/.next/server/app.js?cookie=secret",
                  function: "mintBearer",
                  module: "private-generated-module",
                  lineno: 42,
                  colno: 7,
                  in_app: true,
                  context_line: "const token = 'secret'",
                  pre_context: ["private generated source"],
                  post_context: ["private prompt"],
                  vars: { bearer: "secret" },
                  debug_id: "b".repeat(32),
                },
              ],
            },
          },
        ],
      },
      debug_meta: {
        images: [
          {
            type: "sourcemap",
            code_file: "/var/task/.next/server/app.js?token=secret",
            debug_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          },
          {
            type: "sourcemap",
            code_file: "/tmp/private-generated-app/source.js",
            debug_id: "d".repeat(32),
          },
        ],
      },
    });

    expect(event).toMatchObject({
      level: "error",
      environment: "staging",
      release: "portal-bff@abcdef0",
      transaction: "/api/threads/:param",
      tags: {
        service: "portal-bff",
        route_family: "/api/threads/:param",
        operation: "thread_proxy",
        method: "POST",
        handled: true,
      },
      exception: {
        values: [
          {
            type: "DatabaseError",
            value: "BFF exception",
            mechanism: { type: "generic", handled: true },
            stacktrace: {
              frames: [
                {
                  filename: "/var/task/.next/server/app.js",
                  abs_path: "/var/task/.next/server/app.js",
                  lineno: 42,
                  colno: 7,
                  in_app: true,
                  debug_id: "b".repeat(32),
                },
              ],
            },
          },
        ],
      },
      debug_meta: {
        images: [
          {
            type: "sourcemap",
            code_file: "/var/task/.next/server/app.js",
            debug_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          },
        ],
      },
    });
    expect(event).not.toHaveProperty("message");
    expect(event).not.toHaveProperty("logentry");
    expect(event).not.toHaveProperty("request");
    expect(event).not.toHaveProperty("user");
    expect(event).not.toHaveProperty("extra");
    expect(event).not.toHaveProperty("breadcrumbs");
    expect(event).not.toHaveProperty("contexts");
    expect(event?.tags).not.toHaveProperty("wallet");
    expect(event?.tags).not.toHaveProperty("repository");
    expect(
      event?.exception?.values?.[0]?.stacktrace?.frames?.[0],
    ).not.toHaveProperty("context_line");
    expect(
      event?.exception?.values?.[0]?.stacktrace?.frames?.[0],
    ).not.toHaveProperty("vars");
    expect(
      event?.exception?.values?.[0]?.stacktrace?.frames?.[0],
    ).not.toHaveProperty("function");
    expect(
      event?.exception?.values?.[0]?.stacktrace?.frames?.[0],
    ).not.toHaveProperty("module");
  });

  it("drops generated and artifact stack paths fail closed", () => {
    const event = scrubSentryEvent({
      exception: {
        values: [
          {
            stacktrace: {
              frames: [
                {
                  filename: "/tmp/private-repository/generated-app/tool.js",
                  abs_path: "/tmp/private-repository/generated-app/tool.js",
                  function: "privateAppName",
                  module: "private-repository",
                  lineno: 9,
                },
              ],
            },
          },
        ],
      },
    });

    expect(event?.exception?.values?.[0]?.stacktrace?.frames?.[0]).toEqual({
      lineno: 9,
    });
  });

  it("retains Next server virtual paths used for source-map lookup", () => {
    const codeFile =
      "app:///_next/server/chunks/[root-of-the-server]__abcdef12._.js";
    const debugId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const event = scrubSentryEvent({
      exception: {
        values: [
          {
            stacktrace: {
              frames: [
                {
                  filename: `${codeFile}?token=secret#private`,
                  abs_path: `${codeFile}?cookie=secret`,
                  function: "privateFunction",
                  module: "privateModule",
                  lineno: 1,
                  colno: 1179,
                  in_app: true,
                  debug_id: debugId,
                },
              ],
            },
          },
        ],
      },
      debug_meta: {
        images: [
          {
            type: "sourcemap",
            code_file: `${codeFile}?token=secret`,
            debug_id: debugId,
          },
        ],
      },
    });

    expect(event?.exception?.values?.[0]?.stacktrace?.frames?.[0]).toEqual({
      filename: codeFile,
      abs_path: codeFile,
      lineno: 1,
      colno: 1179,
      in_app: true,
      debug_id: debugId,
      platform: undefined,
    });
    expect(event?.debug_meta).toEqual({
      images: [
        {
          type: "sourcemap",
          code_file: codeFile,
          debug_id: debugId,
        },
      ],
    });
  });

  it("drops non-error events and unsafe environment values", () => {
    expect(scrubSentryEvent({ type: "transaction" })).toBeNull();
    expect(scrubSentryEvent({ environment: "preview" })).not.toHaveProperty(
      "environment",
    );
  });

  it("drops JWT-shaped values even from allowlisted scalar fields", () => {
    const jwt = `${"a".repeat(12)}.${"b".repeat(12)}.${"c".repeat(12)}`;
    const event = scrubSentryEvent({
      platform: jwt,
      tags: { operation: jwt },
    });

    expect(event).not.toHaveProperty("platform");
    expect(event?.tags).toBeUndefined();
  });
});

describe("scrubSentryLog", () => {
  it("retains only fixed messages and allowlisted scalar attributes", () => {
    expect(
      scrubSentryLog({
        level: "fatal",
        message: "bff.upstream_failure",
        attributes: {
          service: "build-bff",
          operation: "launch",
          upstream: "rust",
          "upstream.status_code": 503,
          handled: true,
          "sentry.environment": "staging",
          "sentry.release": "build-bff@abcdef0",
          "sentry.sdk.name": "sentry.javascript.nextjs",
          "user.id": "private-user",
          prompt: "private prompt",
          oauthCode: "private code",
          x402Proof: "private proof",
          transactionData: "private transaction",
          headers: { authorization: "Bearer secret" },
          wallet: "0x123",
          source: "generated source",
          toolResult: ["private MCP output"],
        },
      }),
    ).toEqual({
      level: "error",
      message: "bff.upstream_failure",
      attributes: {
        service: "build-bff",
        operation: "launch",
        upstream: "rust",
        "upstream.status_code": 503,
        handled: true,
        "sentry.environment": "staging",
        "sentry.release": "build-bff@abcdef0",
      },
      severityNumber: undefined,
    });
  });

  it("drops arbitrary log messages instead of trying to redact them", () => {
    expect(
      scrubSentryLog({
        level: "error",
        message: "User prompt: transfer wallet funds",
      }),
    ).toBeNull();
  });
});
