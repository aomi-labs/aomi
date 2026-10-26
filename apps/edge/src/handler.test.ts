// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EdgeCache, EdgeEnv } from "./env";
import { handleRequest } from "./handler";
import { isAllowedCorsOrigin } from "./kernel/cors";
import { config } from "./kernel/config";
import { rankOrigins, resolvePool, routingKeyFor } from "./kernel/pool";
import { resolveRoute } from "./api/routes";
import type { FetchLike } from "./kernel/proxy";
import { resetDiscoveryCache } from "./api/task/challenge";

const env: EdgeEnv = {
  BACKEND_ORIGINS: "https://backend-staging-tunnel.aomi.dev",
  API_SERVER_ORIGIN: "https://agent-staging-2.aomi.dev",
  CORS_ALLOWED_HOST_PATTERNS:
    "*.aomi.dev,*.staging.aomi.dev,api-staging.aomi.dev,chat-staging.aomi.dev,*.vercel.app,dev.wcm.inc",
};

const productionEnv: EdgeEnv = {
  BACKEND_ORIGINS: "https://backend-tunnel.aomi.dev",
  API_SERVER_ORIGIN: "https://agent-2.aomi.dev",
  CORS_ALLOWED_HOST_PATTERNS: "*.aomi.dev,api.aomi.dev,*.vercel.app",
};

const unexpected: FetchLike = async () => new Response("unexpected");
const never: FetchLike = () => {
  throw new Error("must not forward");
};

beforeEach(() => {
  resetDiscoveryCache();
});

describe("route resolution", () => {
  it("keeps /api paths intact for backend", () => {
    const route = resolveRoute(new URL("https://api-staging.aomi.dev/api/chat"), env);
    expect(route?.targets[0].toString()).toBe(
      "https://backend-staging-tunnel.aomi.dev/api/chat",
    );
    expect(route?.name).toBe("api");
  });

  it("exposes only the admitted API Server routes", () => {
    const route = resolveRoute(
      new URL("https://api-staging.aomi.dev/v1/task/build?trace=one"),
      env,
    );
    expect(route?.targets[0].toString()).toBe(
      "https://agent-staging-2.aomi.dev/v1/task/build?trace=one",
    );
    expect(route?.name).toBe("task");
    expect(route?.targets.slice(1)).toEqual([]);
    expect(resolveRoute(new URL("https://api-staging.aomi.dev/v1/task/other"), env)).toBeNull();
    expect(
      resolveRoute(new URL("https://api.aomi.dev/v1/task/build"), productionEnv)?.targets[0].toString(),
    ).toBe("https://agent-2.aomi.dev/v1/task/build");
    expect(
      resolveRoute(new URL("https://api.aomi.dev/v1/task/build"), {
        ...productionEnv,
        API_SERVER_ORIGIN: "",
      }),
    ).toBeNull();
    const jwks = resolveRoute(new URL("https://api.aomi.dev/.well-known/jwks.json"), productionEnv);
    expect(jwks?.targets[0].toString()).toBe("https://agent-2.aomi.dev/.well-known/jwks.json");
    expect(jwks?.name).toBe("jwks");
    expect(
      resolveRoute(new URL("https://api.aomi.dev/.well-known/other.json"), productionEnv),
    ).toBeNull();
  });

  it("forwards /metrics to backend", () => {
    const route = resolveRoute(new URL("https://api-staging.aomi.dev/metrics"), env);
    expect(route?.targets[0].toString()).toBe("https://backend-staging-tunnel.aomi.dev/metrics");
    expect(route?.name).toBe("health");
  });

  it("forwards registered Telegram webhooks through the backend api route", () => {
    const route = resolveRoute(
      new URL("https://api.aomi.dev/api/bots/telegram/secret-123?update_id=1"),
      productionEnv,
    );
    expect(route?.targets[0].toString()).toBe(
      "https://backend-tunnel.aomi.dev/api/bots/telegram/secret-123?update_id=1",
    );
    expect(route?.name).toBe("api");
  });

  it("admits only UUID Task job resources", () => {
    const jobEnv = { API_SERVER_ORIGIN: "https://api-server.example" };
    const id = "00000000-0000-0000-0000-000000000001";
    for (const operation of ["status", "result"]) {
      expect(resolveRoute(new URL(`https://api.example/v1/task/${id}/${operation}`), jobEnv)).not.toBeNull();
      expect(resolveRoute(new URL(`https://api.example/v1/task/not-a-uuid/${operation}`), jobEnv)).toBeNull();
    }
    expect(resolveRoute(new URL(`https://api.example/v1/task/${id}/execute`), jobEnv)).toBeNull();
  });
});

describe("CORS", () => {
  it("accepts exact and wildcard hosts", () => {
    const cases: Array<[string, boolean]> = [
      ["https://api-staging.aomi.dev", true],
      ["https://app.aomi.dev", true],
      ["https://app.staging.aomi.dev", true],
      ["https://chat-staging.aomi.dev", true],
      ["https://preview-project.vercel.app", true],
      // Exact host, not a wildcard: `*.wcm.inc` would also admit their
      // MegaETH deployment, which runs the same ABI on a different chain.
      ["https://dev.wcm.inc", true],
      ["https://staging.wcm.inc", false],
      ["https://dev.wcm.inc.evil.com", false],
      ["https://evil.example.com", false],
    ];
    for (const [origin, allowed] of cases) {
      expect(isAllowedCorsOrigin(origin, config(env)), origin).toBe(allowed);
    }
  });

  it("answers OPTIONS preflight without hitting origin", async () => {
    let fetchCalls = 0;
    const response = await handleRequest(
      new Request("https://api-staging.aomi.dev/api/chat", {
        method: "OPTIONS",
        headers: {
          Origin: "https://app.staging.aomi.dev",
          "Access-Control-Request-Method": "POST",
        },
      }),
      env,
      async () => {
        fetchCalls += 1;
        return new Response("unexpected");
      },
    );
    expect(fetchCalls).toBe(0);
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://app.staging.aomi.dev");
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });

  it("Task preflight permits the separate Gateway payment signature", async () => {
    const response = await handleRequest(
      new Request("https://api-staging.aomi.dev/v1/task/build", {
        method: "OPTIONS",
        headers: {
          Origin: "https://builder.staging.aomi.dev",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type,payment-signature",
        },
      }),
      env,
      unexpected,
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Headers")).toMatch(/Payment-Signature/);
    expect(response.headers.get("Access-Control-Allow-Headers")).not.toMatch(/Authorization/);
  });

  it("JWKS is readable cross-origin without credentials", async () => {
    const response = await handleRequest(
      new Request("https://api.aomi.dev/.well-known/jwks.json", {
        headers: { Origin: "https://external-client.example" },
      }),
      productionEnv,
      async () => new Response(JSON.stringify({ keys: [] }), { status: 200 }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, OPTIONS");
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });
});

describe("proxying", () => {
  it("proxies matched routes and decorates the response", async () => {
    let upstream: Request | null = null;
    const response = await handleRequest(
      new Request("https://api-staging.aomi.dev/health", {
        headers: { Origin: "https://app.staging.aomi.dev", "CF-Connecting-IP": "203.0.113.10" },
      }),
      env,
      async (request) => {
        upstream = request;
        return new Response("ok", { status: 200, headers: { "Content-Type": "text/plain" } });
      },
    );
    const forwarded = upstream as Request | null;
    expect(forwarded?.url).toBe("https://backend-staging-tunnel.aomi.dev/health");
    expect(forwarded?.headers.get("X-Real-IP")).toBe("203.0.113.10");
    expect(forwarded?.headers.get("X-Forwarded-For")).toBe("203.0.113.10");
    expect(forwarded?.headers.get("X-Forwarded-Proto")).toBe("https");
    expect(response.status).toBe(200);
    expect(response.headers.get("Strict-Transport-Security")).toBe("max-age=31536000");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://app.staging.aomi.dev");
  });

  it("proxies /metrics with the caller's authorization header", async () => {
    let authorization: string | null = null;
    const response = await handleRequest(
      new Request("https://api-staging.aomi.dev/metrics", {
        headers: { Authorization: "Bearer test-token", Origin: "https://app.staging.aomi.dev" },
      }),
      env,
      async (request) => {
        authorization = request.headers.get("Authorization");
        return new Response("metrics", { status: 200 });
      },
    );
    expect(authorization).toBe("Bearer test-token");
    expect(response.status).toBe(200);
  });

  it("returns 404 without hitting origin for removed, legacy and unmatched paths", async () => {
    for (const [url, routeEnv] of [
      ["https://api-staging.aomi.dev/mcp/sse/connect", env],
      ["https://api-staging.aomi.dev/anvil/", env],
      ["https://api.aomi.dev/bot", productionEnv],
      ["https://api.aomi.dev/bot?update_id=1", productionEnv],
      ["https://api-staging.aomi.dev/nope", env],
    ] as const) {
      let fetchCalls = 0;
      const response = await handleRequest(new Request(url), routeEnv, async () => {
        fetchCalls += 1;
        return new Response("unexpected");
      });
      expect(response.status, url).toBe(404);
      expect(fetchCalls, url).toBe(0);
    }
  });
});

const ORIGINS = [
  "https://backend-1.aomi.dev",
  "https://backend-2.aomi.dev",
  "https://backend-3.aomi.dev",
];
const multiEnv: EdgeEnv = {
  BACKEND_ORIGINS: `${ORIGINS[0]}, ${ORIGINS[1]},${ORIGINS[2]}`,
  CORS_ALLOWED_HOST_PATTERNS: "*.aomi.dev",
};

describe("multi-origin load balancing", () => {
  it("parses BACKEND_ORIGINS and has no single-origin fallback", () => {
    expect(resolvePool(multiEnv)).toEqual(ORIGINS);
    expect(resolvePool(env)).toEqual(["https://backend-staging-tunnel.aomi.dev"]);
    expect(resolvePool({})).toEqual([]);
  });

  it("only routes a hosted app to origins whose availability probe succeeds", async () => {
    const origins: string[] = [];
    const probes: string[] = [];
    const staticHome = rankOrigins("42", ORIGINS)[0];
    const onlyAvailableHere = ORIGINS.find((origin) => origin !== staticHome);
    const response = await handleRequest(
      new Request("https://api.aomi.dev/api/thread/state?application_id=42", {
        headers: { "X-Thread-Id": "app-thread" },
      }),
      multiEnv,
      async (request) => {
        const target = new URL(request.url);
        if (target.pathname === "/availability") {
          probes.push(target.origin);
          return new Response("OK", { status: target.origin === onlyAvailableHere ? 200 : 404 });
        }
        origins.push(target.origin);
        return new Response("ok");
      },
    );
    expect(response.status).toBe(200);
    expect(onlyAvailableHere).not.toBe(staticHome);
    expect([...probes].sort()).toEqual([...ORIGINS].sort());
    expect(origins).toEqual([onlyAvailableHere]);
  });

  it("abandons a hung availability probe and serves from a healthy origin", async () => {
    vi.useFakeTimers();
    try {
      const forwarded: string[] = [];
      let aborted = false;
      const pending = handleRequest(
        new Request("https://api.aomi.dev/api/thread/state?application_id=42"),
        multiEnv,
        async (request) => {
          const url = new URL(request.url);
          if (url.pathname === "/availability") {
            if (url.origin === ORIGINS[0]) return new Promise<Response>((_resolve, reject) => {
              request.signal.addEventListener("abort", () => {
                aborted = true;
                reject(new Error("probe aborted"));
              }, { once: true });
            });
            return new Response(null, { status: url.origin === ORIGINS[1] ? 200 : 404 });
          }
          forwarded.push(url.origin);
          return new Response("healthy");
        },
      );
      await vi.advanceTimersByTimeAsync(1_499);
      expect(forwarded).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect((await pending).status).toBe(200);
      expect(aborted).toBe(true);
      expect(forwarded).toEqual([ORIGINS[1]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for a cold hosted app to materialize", async () => {
    const waits: number[] = [];
    const origins: string[] = [];
    let probes = 0;
    const response = await handleRequest(
      new Request("https://api.aomi.dev/api/thread/chat?application_id=42", {
        method: "POST",
        body: "{}",
      }),
      { ...multiEnv, HOSTED_APP_WARMUP_ATTEMPTS: "3", HOSTED_APP_WARMUP_RETRY_MS: "250" },
      async (request) => {
        const target = new URL(request.url);
        if (target.pathname === "/availability") {
          probes += 1;
          return new Response("OK", { status: probes > ORIGINS.length ? 200 : 404 });
        }
        origins.push(target.origin);
        return new Response("ok");
      },
      async (delayMs) => {
        waits.push(delayMs);
      },
    );
    expect(response.status).toBe(200);
    expect(probes).toBe(ORIGINS.length * 2);
    expect(waits).toEqual([250]);
    expect(origins.length).toBe(1);
  });

  it("returns 503 instead of sending a hosted app to an unavailable origin", async () => {
    let appRequests = 0;
    const response = await handleRequest(
      new Request("https://api.aomi.dev/api/thread/chat?application_id=42", {
        method: "POST",
        body: "{}",
      }),
      multiEnv,
      async (request) => {
        if (new URL(request.url).pathname === "/availability") {
          return new Response("missing", { status: 404 });
        }
        appRequests += 1;
        return new Response("unexpected");
      },
    );
    expect(response.status).toBe(503);
    expect(appRequests).toBe(0);
  });

  it("keeps the availability probe origin-direct and unrouted at the edge", async () => {
    const response = await handleRequest(
      new Request("https://api.aomi.dev/availability?application_id=42"),
      multiEnv,
      unexpected,
    );
    expect(response.status).toBe(404);
  });

  it("never availability-constrains /health or /api/_internal reads", async () => {
    for (const path of ["/health?application_id=42", "/api/_internal/secrets?application_id=42"]) {
      const paths: string[] = [];
      const response = await handleRequest(
        new Request(`https://api.aomi.dev${path}`, {
          headers: { Authorization: "Bearer service-token" },
        }),
        multiEnv,
        async (request) => {
          const pathname = new URL(request.url).pathname;
          paths.push(pathname);
          if (pathname === "/availability") return new Response("missing", { status: 404 });
          return new Response("{}", { status: 200 });
        },
      );
      expect(response.status, path).toBe(200);
      expect(paths, path).toEqual([new URL(`https://api.aomi.dev${path}`).pathname]);
    }
  });

  it("rankOrigins is deterministic and uses every origin across keys", () => {
    const first = rankOrigins("session-abc", ORIGINS);
    expect(rankOrigins("session-abc", ORIGINS)).toEqual(first);
    expect([...first].sort()).toEqual([...ORIGINS].sort());
    const primaries = new Set<string>();
    for (let i = 0; i < 60; i += 1) primaries.add(rankOrigins(`session-${i}`, ORIGINS)[0]);
    expect(primaries.size).toBe(ORIGINS.length);
    expect(rankOrigins(null, ORIGINS)).toEqual(ORIGINS);
  });

  it("routingKeyFor prefers a thread path id, then headers, then client IP", () => {
    for (const path of [
      "/api/threads/target-thread",
      "/api/sessions/target-thread",
      "/v1/agent/chat/target-thread",
      "/v1/agent/chat/target-thread/interrupt",
    ]) {
      const url = new URL(`https://api.aomi.dev${path}`);
      const request = new Request(url, { method: "DELETE", headers: { "X-Session-Id": "caller-thread" } });
      expect(routingKeyFor(request, url)).toBe("target-thread");
    }
    const url = new URL("https://api.aomi.dev/api/chat");
    expect(routingKeyFor(new Request(url, { headers: { "X-Thread-Id": "t-1", "X-Session-Id": "s-1" } }), url)).toBe("t-1");
    expect(routingKeyFor(new Request(url, { headers: { "X-Session-Id": "s-1", "CF-Connecting-IP": "203.0.113.10" } }), url)).toBe("s-1");
    expect(routingKeyFor(new Request(url, { headers: { "CF-Connecting-IP": "203.0.113.10" } }), url)).toBe("203.0.113.10");
    expect(routingKeyFor(new Request(url), url)).toBeNull();
    const webhook = new URL("https://api.aomi.dev/api/bots/telegram/a-secret");
    expect(routingKeyFor(new Request(webhook, { headers: { "CF-Connecting-IP": "203.0.113.10" } }), webhook)).toBe("a-secret");
  });

  it("pins a session to its rendezvous owner and fails over only idempotent requests", async () => {
    const ranked = rankOrigins("session-abc", ORIGINS);
    const hosts: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const response = await handleRequest(
        new Request("https://api.aomi.dev/api/state", { headers: { "X-Session-Id": "session-abc" } }),
        multiEnv,
        async (request) => {
          hosts.push(new URL(request.url).origin);
          return new Response("ok");
        },
      );
      expect(response.status).toBe(200);
    }
    expect(hosts).toEqual([ranked[0], ranked[0]]);

    for (const ownerResponse of [
      () => {
        throw new Error("tunnel down");
      },
      () => new Response("bad gateway", { status: 502 }),
    ]) {
      const attempts: string[] = [];
      const response = await handleRequest(
        new Request("https://api.aomi.dev/api/state", { headers: { "X-Session-Id": "session-abc" } }),
        multiEnv,
        async (request) => {
          const origin = new URL(request.url).origin;
          attempts.push(origin);
          return origin === ranked[0] ? ownerResponse() : new Response("ok");
        },
      );
      expect(response.status).toBe(200);
      expect(attempts).toEqual([ranked[0], ranked[1]]);
    }

    const postAttempts: string[] = [];
    const ambiguous = await handleRequest(
      new Request("https://api.aomi.dev/api/chat", {
        method: "POST",
        headers: { "X-Session-Id": "session-abc" },
        body: JSON.stringify({ message: "hello" }),
      }),
      multiEnv,
      async (request) => {
        postAttempts.push(new URL(request.url).origin);
        throw new Error("ambiguous origin failure");
      },
    );
    expect(ambiguous.status).toBe(502);
    expect(await ambiguous.json()).toEqual({ error: "upstream_unavailable" });
    expect(postAttempts).toEqual([ranked[0]]);

    const tunnelDown = await handleRequest(
      new Request("https://api.aomi.dev/api/chat", { method: "POST", headers: { "X-Session-Id": "session-abc" }, body: "{}" }),
      multiEnv,
      async () => new Response("bad gateway", { status: 502 }),
    );
    expect(tunnelDown.status).toBe(502);

    const serverError = await handleRequest(
      new Request("https://api.aomi.dev/api/state", { headers: { "X-Session-Id": "session-abc" } }),
      multiEnv,
      async () => new Response("boom", { status: 500 }),
    );
    expect(serverError.status).toBe(500);
  });
});

describe("manager cutover routing", () => {
  const managerEnv: EdgeEnv = { ...env, MANAGER_ORIGIN: "https://manager-staging-tunnel.aomi.dev" };

  it("is inert while MANAGER_ORIGIN is unset", () => {
    const route = resolveRoute(new URL("https://api-staging.aomi.dev/api/platforms/community/deploy"), env);
    expect(route?.targets[0].toString()).toBe(
      "https://backend-staging-tunnel.aomi.dev/api/platforms/community/deploy",
    );
  });

  it("moves manager-owned routes to MANAGER_ORIGIN when set", () => {
    for (const path of [
      "/api/platforms",
      "/api/platforms/server-tags",
      "/api/platforms/community/activate",
      "/api/platforms/community/apps/activate",
      "/api/platforms/community/applications/77/deactivate",
      "/api/platforms/community/deployments/dep_1_2_3/status",
      "/api/platforms/community/apps/geckoterminal/records",
      "/api/platforms/community/tokens/42",
      "/api/platforms/community/venue",
      "/api/platforms/community/telegram/handover",
      "/api/platforms/community/telegram/handover/nonce",
      "/api/platforms/community/telegram/handover/world-bot/42/status",
      "/api/projects/42/deploy",
      "/api/integrations/github-app/webhook",
      "/api/integrations/github-app/oauth/claim",
      "/api/integrations/github-app/builder/applications/77/tools/swap_quote/trace",
      "/api/integrations/github-app/user/projects/42/attempts/7/cancel",
      "/api/integrations/github-app/user/bots/bot-42/command-secret",
      "/api/integrations/github-app/user/model-keys/42/grants",
      "/api/integrations/github-app/user/projects/42/deployments/dep_1_2_3/promote",
      "/api/integrations/github-app/user/projects/42/releases/activate",
      "/api/integrations/github-app/platforms/community/projects/create-from-template",
      "/api/manager/openapi.json",
      "/api/account/bots/bot-42",
      "/api/integrations/github-app/builder/applications/42/app-key",
    ]) {
      const route = resolveRoute(new URL(`https://api-staging.aomi.dev${path}`), managerEnv);
      expect(route?.targets[0].toString(), path).toBe(`https://manager-staging-tunnel.aomi.dev${path}`);
      expect(route?.name).toBe("api");
      expect(route?.targets.slice(1)).toEqual([]);
    }
  });

  it("keeps non-manager routes on the backend", () => {
    for (const path of [
      "/api/integrations/github-app/user/projects/42/apps/77/detail",
      "/api/platforms/community/deploy",
      "/api/platforms/community/apps",
      "/api/account",
      "/api/account/grants",
      "/api/account/apps",
      "/api/account/bots/bot_1/extra",
      "/api/account/providers/para/agent-wallet",
    ]) {
      const route = resolveRoute(new URL(`https://api-staging.aomi.dev${path}`), managerEnv);
      expect(route?.targets[0].toString(), path).toBe(`https://backend-staging-tunnel.aomi.dev${path}`);
    }
  });
});

describe("Task discovery documents", () => {
  it("admits only the public documents with read-only public CORS", async () => {
    for (const path of ["/.well-known/agent.json", "/v1/task/openapi.json", "/.well-known/x402"]) {
      const url = new URL(`https://api-staging.aomi.dev${path}`);
      expect(resolveRoute(url, env)?.targets[0].toString()).toBe(`https://agent-staging-2.aomi.dev${path}`);
      expect(resolveRoute(url, { ...productionEnv, API_SERVER_ORIGIN: "" })).toBeNull();
      const preflight = await handleRequest(
        new Request(url, { method: "OPTIONS", headers: { Origin: "https://directory.example" } }),
        env,
        unexpected,
      );
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(preflight.headers.get("Access-Control-Allow-Methods")).toBe("GET, HEAD, OPTIONS");
      expect(preflight.headers.get("Access-Control-Allow-Credentials")).toBeNull();
      const document = await handleRequest(new Request(url), env, async (request) => {
        expect(request.url).toBe(`https://agent-staging-2.aomi.dev${path}`);
        return Response.json({ fixture: true });
      });
      expect(document.status).toBe(200);
      expect(document.headers.get("Access-Control-Allow-Origin")).toBe("*");
    }
    for (const path of ["/.well-known/api-catalog", "/.well-known/keys", "/v1/payment/task/terms"]) {
      expect(resolveRoute(new URL(`https://api-staging.aomi.dev${path}`), env)).toBeNull();
    }
  });

  it("serves only the Task document at the domain OpenAPI path", async () => {
    const url = new URL("https://api-staging.aomi.dev/openapi.json?source=crawler");
    const upstream = "https://agent-staging-2.aomi.dev/v1/task/openapi.json?source=crawler";
    expect(resolveRoute(url, env)?.targets[0].toString()).toBe(upstream);
    for (const method of ["GET", "HEAD"]) {
      const response = await handleRequest(new Request(url, { method }), env, async (request) => {
        expect(request.url).toBe(upstream);
        expect(request.method).toBe(method);
        return new Response(method === "GET" ? '{"paths":{}}' : null, {
          headers: { "Content-Type": "application/json" },
        });
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    }
    for (const path of ["/openapi.json/extra", "/openapi.yaml"]) {
      expect(resolveRoute(new URL(`https://api-staging.aomi.dev${path}`), env)).toBeNull();
    }
  });
});

// The API Server's real behaviour, as the venue adapters see it: GET is
// metadata, a valid POST without a signature is a body-bound 402.
const EXAMPLE = {
  intent: "Simulate a no-op on Arc Testnet. Do not sign or broadcast any transaction.",
  chainId: 5042002,
  sender: "0x000000000000000000000000000000000000dEaD",
};
const METADATA = {
  endpoint: "https://api-staging.aomi.dev/v1/task/build",
  method: "POST",
  preparationPriceMicroUsdc: "10000",
  exampleRequest: EXAMPLE,
};
const CHALLENGE_BODY = {
  status: "payment_required",
  stage: "preparation",
  amountMicrousd: "10000",
  refundPolicy: "paid_attempt",
  paymentRequired: "eyJ4NDAyVmVyc2lvbiI6Mn0=",
};

// Bodies the fake upstream read, by request: the handler is allowed to hand
// the upstream a one-shot stream, so tests read bodies here, not by clone.
const bodyOf = new WeakMap<Request, string>();

function apiServer(log: Request[] = []): FetchLike {
  return async (request) => {
    log.push(request);
    if (request.method !== "GET" && request.method !== "HEAD") {
      bodyOf.set(request, await request.text());
    }
    const url = new URL(request.url);
    if (url.pathname !== "/v1/task/build") return new Response("nope", { status: 404 });
    if (request.method === "GET") return Response.json(METADATA);
    if (request.headers.get("authorization")) return new Response("{}", { status: 401 });
    if (request.headers.get("content-type")?.split(";")[0] !== "application/json") {
      return new Response("{}", { status: 415 });
    }
    const text = bodyOf.get(request) ?? "";
    if (!text) return new Response("{}", { status: 422 });
    if (request.headers.get("payment-signature")) {
      return Response.json({ quoteId: "job", status: "queued" }, { status: 202 });
    }
    return Response.json(CHALLENGE_BODY, {
      status: 402,
      headers: { "Payment-Required": CHALLENGE_BODY.paymentRequired },
    });
  };
}

describe("Task venue adapters", () => {
  const url = "https://api-staging.aomi.dev/v1/task/build";

  it("never forwards a venue's Authorization, cookie or router headers on Task routes", async () => {
    const log: Request[] = [];
    const response = await handleRequest(
      new Request(url, {
        method: "POST",
        headers: {
          Authorization: "Bearer venue-token",
          Cookie: "session=abc",
          "X-Venue-Trace": "t",
          "Content-Type": "application/json",
          "Payment-Signature": "proof",
          "CF-Connecting-IP": "203.0.113.10",
        },
        body: JSON.stringify(EXAMPLE),
      }),
      env,
      apiServer(log),
    );
    expect(response.status).toBe(202);
    const [upstream] = log;
    expect(upstream.headers.get("authorization")).toBeNull();
    expect(upstream.headers.get("cookie")).toBeNull();
    expect(upstream.headers.get("x-venue-trace")).toBeNull();
    expect(upstream.headers.get("payment-signature")).toBe("proof");
    expect(upstream.headers.get("content-type")).toBe("application/json");
    expect(upstream.headers.get("x-real-ip")).toBe("203.0.113.10");

    const jobLog: Request[] = [];
    await handleRequest(
      new Request("https://api-staging.aomi.dev/v1/task/00000000-0000-0000-0000-000000000001/status", {
        method: "POST",
        headers: { Authorization: "Bearer venue-token", "Content-Type": "application/json" },
        body: JSON.stringify({ retrievalToken: "t" }),
      }),
      env,
      async (request) => {
        jobLog.push(request);
        return Response.json({ status: "queued" });
      },
    );
    expect(jobLog[0].headers.get("authorization")).toBeNull();
  });

  it("answers GET and HEAD with the cached body-bound 402, probing the upstream once", async () => {
    const log: Request[] = [];
    const first = await handleRequest(
      new Request(url, { headers: { Origin: "https://external-client.example" } }),
      env,
      apiServer(log),
    );
    expect(first.status).toBe(402);
    expect(first.headers.get("Payment-Required")).toBe(CHALLENGE_BODY.paymentRequired);
    expect(first.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(first.headers.get("Access-Control-Expose-Headers")).toBe("Payment-Required");
    expect(first.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    const body = (await first.json()) as Record<string, unknown>;
    expect(body.exampleRequest).toEqual(EXAMPLE);
    expect(body.status).toBe("payment_required");
    expect(body.paymentRequired).toBe(CHALLENGE_BODY.paymentRequired);
    expect(log.map((request) => request.method)).toEqual(["GET", "POST"]);
    expect(JSON.parse(bodyOf.get(log[1]) ?? "")).toEqual(EXAMPLE);

    const head = await handleRequest(new Request(url, { method: "HEAD" }), env, apiServer(log));
    expect(head.status).toBe(402);
    expect(head.headers.get("Payment-Required")).toBe(CHALLENGE_BODY.paymentRequired);
    expect(await head.text()).toBe("");
    const second = await handleRequest(new Request(url), env, apiServer(log));
    expect(second.status).toBe(402);
    expect(log.length, "cache hit: no second probe").toBe(2);
  });

  it("answers an empty POST with the cached 402 instead of the upstream 422", async () => {
    const log: Request[] = [];
    const response = await handleRequest(
      new Request(url, { method: "POST", headers: { Origin: "https://builder.staging.aomi.dev" } }),
      env,
      apiServer(log),
    );
    expect(response.status).toBe(402);
    expect(response.headers.get("Payment-Required")).toBe(CHALLENGE_BODY.paymentRequired);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://builder.staging.aomi.dev");
    expect(response.headers.get("Access-Control-Expose-Headers")).toBe("Payment-Required, Payment-Response");
    // Only the probe reached the upstream; the empty venue POST never did.
    expect(log.map((request) => request.method)).toEqual(["GET", "POST"]);
    expect(bodyOf.get(log[1])).toBe(JSON.stringify(EXAMPLE));
  });

  it("relabels a text/plain JSON body as application/json with the same bytes", async () => {
    const log: Request[] = [];
    const bytes = JSON.stringify(EXAMPLE, null, 2);
    const response = await handleRequest(
      new Request(url, { method: "POST", headers: { "Content-Type": "text/plain" }, body: bytes }),
      env,
      apiServer(log),
    );
    expect(response.status).toBe(402);
    expect(log).toHaveLength(1);
    expect(log[0].headers.get("content-type")).toBe("application/json");
    expect(bodyOf.get(log[0])).toBe(bytes);
  });

  it("leaves a body that is not JSON for the upstream's own 415", async () => {
    const log: Request[] = [];
    const response = await handleRequest(
      new Request(url, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "hello" }),
      env,
      apiServer(log),
    );
    expect(response.status).toBe(415);
    expect(log[0].headers.get("content-type")).toBe("text/plain");
  });

  it("falls back to the metadata when the upstream yields no challenge", async () => {
    const response = await handleRequest(
      new Request(url, { headers: { Origin: "https://external-client.example" } }),
      env,
      async (request) =>
        request.method === "GET"
          ? Response.json({ ...METADATA, exampleRequest: undefined })
          : new Response("{}", { status: 500 }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Payment-Required")).toBeNull();
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("stores the challenge in KV with the quote's margin and reads it back", async () => {
    const store = new Map<string, string>();
    const puts: Array<{ key: string; ttl?: number }> = [];
    const cache: EdgeCache = {
      get: async (key) => store.get(key) ?? null,
      put: async (key, value, options) => {
        store.set(key, value);
        puts.push({ key, ttl: options?.expirationTtl });
      },
    };
    const log: Request[] = [];
    await handleRequest(new Request(url), { ...env, EDGE_CACHE: cache }, apiServer(log));
    expect(puts).toEqual([{ key: "task:discovery:v1:agent-staging-2.aomi.dev", ttl: 240 }]);
    const warm = await handleRequest(new Request(url), { ...env, EDGE_CACHE: cache }, never);
    expect(warm.status).toBe(402);
    expect(warm.headers.get("Payment-Required")).toBe(CHALLENGE_BODY.paymentRequired);
  });

  it("keeps paid POST origin-restricted while GET discovery is public", async () => {
    const origin = "https://external-client.example";
    const getPreflight = await handleRequest(
      new Request(url, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "GET" } }),
      env,
      unexpected,
    );
    expect(getPreflight.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(getPreflight.headers.get("Access-Control-Allow-Methods")).toBe("GET, HEAD, OPTIONS");
    const postPreflight = await handleRequest(
      new Request(url, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST" } }),
      env,
      unexpected,
    );
    expect(postPreflight.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const paid = await handleRequest(
      new Request(url, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify(EXAMPLE),
      }),
      env,
      apiServer(),
    );
    expect(paid.status).toBe(402);
    expect(paid.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("exposes payment challenge and receipt to admitted browser origins", async () => {
    for (const status of [402, 200]) {
      const response = await handleRequest(
        new Request(url, {
          method: "POST",
          headers: { Origin: "https://builder.staging.aomi.dev", "Content-Type": "application/json" },
          body: JSON.stringify(EXAMPLE),
        }),
        env,
        async () =>
          new Response("{}", {
            status,
            headers: { "Payment-Required": "challenge", "Payment-Response": "receipt" },
          }),
      );
      expect(response.status).toBe(status);
      expect(response.headers.get("Access-Control-Expose-Headers")).toBe("Payment-Required, Payment-Response");
      expect(response.headers.get("Payment-Required")).toBe("challenge");
      expect(response.headers.get("Payment-Response")).toBe("receipt");
    }
  });

  it("lets StableOps inspect a staging 402 without credentialed API access", async () => {
    const stagingEnv = { ...env, TASK_CORS_PUBLIC_ORIGINS: "https://stableops.dev" };
    const headers = {
      Origin: "https://stableops.dev",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type,payment-signature",
    };
    const preflight = await handleRequest(new Request(url, { method: "OPTIONS", headers }), stagingEnv, unexpected);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(headers.Origin);
    expect(preflight.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    const challenge = await handleRequest(
      new Request(url, {
        method: "POST",
        headers: { Origin: headers.Origin, "Content-Type": "application/json" },
        body: JSON.stringify(EXAMPLE),
      }),
      stagingEnv,
      async () =>
        new Response("{}", {
          status: 402,
          headers: { "Payment-Required": "challenge", "Access-Control-Allow-Credentials": "true" },
        }),
    );
    expect(challenge.headers.get("Access-Control-Allow-Origin")).toBe(headers.Origin);
    expect(challenge.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    const otherApi = await handleRequest(
      new Request("https://api-staging.aomi.dev/api/chat", { method: "OPTIONS", headers }),
      stagingEnv,
      unexpected,
    );
    expect(otherApi.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const lookalike = await handleRequest(
      new Request(url, { method: "OPTIONS", headers: { ...headers, Origin: "https://stableops.dev.evil.example" } }),
      stagingEnv,
      unexpected,
    );
    expect(lookalike.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("payment edge", () => {
  const paymentEnv: EdgeEnv = { ...env, PAYMENT_ORIGIN: "https://payment.example" };

  it("preserves challenge, signature, idempotency and body", async () => {
    let calls = 0;
    const body = JSON.stringify({ amount_microusd: 1000000 });
    const response = await handleRequest(
      new Request("https://api.aomi.dev/v1/account/credits/funding-events", {
        method: "POST",
        body,
        headers: {
          Origin: "https://chat.aomi.dev",
          Authorization: "Bearer delegated",
          "Idempotency-Key": "one",
          "Payment-Signature": "proof",
        },
      }),
      paymentEnv,
      async (request) => {
        calls += 1;
        expect(request.url).toBe("https://payment.example/v1/account/credits/funding-events");
        expect(request.headers.get("authorization")).toBe("Bearer delegated");
        expect(request.headers.get("idempotency-key")).toBe("one");
        expect(request.headers.get("payment-signature")).toBe("proof");
        expect(await request.text()).toBe(body);
        return new Response('{"code":"payment_required"}', {
          status: 402,
          headers: { "Payment-Required": "challenge", "Payment-Response": "receipt" },
        });
      },
    );
    expect(calls).toBe(1);
    expect(response.status).toBe(402);
    expect(response.headers.get("payment-required")).toBe("challenge");
    expect(await response.text()).toBe('{"code":"payment_required"}');
  });

  it("rejects wrong methods before forwarding and keeps funding routes exact", async () => {
    for (const method of ["DELETE", "GET"]) {
      const response = await handleRequest(
        new Request("https://api.aomi.dev/v1/account/credits/funding-events", { method }),
        paymentEnv,
        never,
      );
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST, OPTIONS");
    }
    const id = "00000000-0000-0000-0000-000000000001";
    for (const [path, method] of [
      ["/v1/account/credits/methods", "GET"],
      ["/v1/account/credits/funding-events", "POST"],
      [`/v1/account/credits/funding-events/${id}`, "GET"],
      ["/v1/account/credits/funding-events/current", "GET"],
      [`/v1/account/credits/funding-events/${id}/cancel`, "POST"],
    ] as const) {
      const response = await handleRequest(
        new Request(`https://api.aomi.dev${path}`, { method }),
        paymentEnv,
        async (request) => {
          expect(request.url).toBe(`https://payment.example${path}`);
          return new Response("{}");
        },
      );
      expect(response.status).toBe(200);
    }
    const raw = '{ "data": {"object": "test"}, "unicode": "£" }\n';
    const webhook = await handleRequest(
      new Request("https://api.aomi.dev/v1/payment/webhooks/stripe", {
        method: "POST",
        body: raw,
        headers: { "Stripe-Signature": "t=1,v1=test" },
      }),
      paymentEnv,
      async (request) => {
        expect(request.headers.get("stripe-signature")).toBe("t=1,v1=test");
        expect(await request.text()).toBe(raw);
        return new Response(null, { status: 204 });
      },
    );
    expect(webhook.status).toBe(204);
    for (const path of ["/v1/payment/admit", "/v1/payment/webhooks/other", `/v1/account/credits/funding-events/${id}/fulfill`]) {
      expect(resolveRoute(new URL(`https://api.aomi.dev${path}`), paymentEnv)).toBeNull();
    }
  });
});
