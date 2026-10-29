// The edge Worker in front of a Portal under browser test, the way Cloudflare
// routes it in production: the Worker (apps/edge under `wrangler dev --local`)
// answers the portal host's /api/*, /v1/* and /.well-known/* paths and passes
// what it does not serve to the Next.js portal; every other path reaches the
// portal directly. One public origin, host-only cookies, the Worker as the only
// bearer issuer.
import { spawn, type ChildProcess } from "node:child_process";
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { edgePrivateKey } from "./edge-keys";

export const EDGE_ROOT = fileURLToPath(new URL("../../apps/edge/", import.meta.url));

/** The portal-host paths Cloudflare routes to the Worker (each environment's EDGE_ROUTES). */
export const EDGE_PORTAL_PATHS: readonly RegExp[] = [
  /^\/api(?:\/|$)/,
  /^\/v1(?:\/|$)/,
  /^\/\.well-known(?:\/|$)/,
];

export function routedToEdge(pathname: string): boolean {
  return EDGE_PORTAL_PATHS.some((pattern) => pattern.test(pathname));
}

export type EdgeHostInput = {
  /** The public portal origin's port; the router listens here on 127.0.0.1. */
  port: number;
  /** Where the Next.js portal listens (never the public origin). */
  portalUpstream: string;
  /** The fake agent upstream: backend, API Server and payment origins at once. */
  agentUpstream: string;
  /** Embedding origins whose cookie reads and writes the portal trusts. */
  trustedOrigins?: readonly string[];
  log?: (text: string) => void;
};

/** Wrangler vars for the Worker as the portal surface of one public origin. */
export function edgeVars(input: EdgeHostInput): Record<string, string> {
  const publicHost = `127.0.0.1:${input.port}`;
  return {
    EDGE_TOPOLOGY: "default",
    EDGE_SERVICE_PRIVATE_KEY: edgePrivateKey,
    BACKEND_ORIGINS: input.agentUpstream,
    API_SERVER_ORIGIN: input.agentUpstream,
    PAYMENT_ORIGIN: input.agentUpstream,
    PORTAL_HOSTS: publicHost,
    PORTAL_UPSTREAM_ORIGIN: input.portalUpstream,
    PORTAL_TRUSTED_ORIGINS: (input.trustedOrigins ?? []).join(","),
    CORS_ALLOWED_HOST_PATTERNS: publicHost,
  };
}

export type EdgeHost = {
  /** The public portal origin (the router). */
  origin: string;
  /** Where the Worker itself listens. */
  workerOrigin: string;
  close(): Promise<void>;
};

/** Start the Worker and the path router; `close` stops both. */
export async function startEdgeHost(input: EdgeHostInput): Promise<EdgeHost> {
  const log = input.log ?? (() => undefined);
  const [workerPort, inspectorPort] = await Promise.all([freePort(), freePort()]);
  const workerOrigin = `http://127.0.0.1:${workerPort}`;
  const args = [
    "dev",
    "--local",
    "--ip",
    "127.0.0.1",
    "--port",
    String(workerPort),
    "--inspector-port",
    String(inspectorPort),
    "--show-interactive-dev-session",
    "false",
    ...Object.entries(edgeVars(input)).flatMap(([key, value]) => ["--var", `${key}:${value}`]),
  ];
  // Same process group as the caller, so whoever kills the caller's group
  // (Playwright's webServer teardown, the runners' killGroup) takes wrangler
  // and its workerd with it; wrangler stops workerd itself on SIGTERM.
  const worker = spawn(join(EDGE_ROOT, "node_modules/.bin/wrangler"), args, {
    cwd: EDGE_ROOT,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  worker.stdout?.on("data", (chunk) => log(`edge: ${chunk}`));
  worker.stderr?.on("data", (chunk) => log(`edge: ${chunk}`));
  const stopWorker = () => {
    if (worker.exitCode === null && worker.signalCode === null) worker.kill("SIGTERM");
  };
  try {
    await waitForAnyResponse(workerOrigin, worker);
  } catch (error) {
    stopWorker();
    throw error;
  }
  const router = createRouter(input.port, workerOrigin, input.portalUpstream, log);
  await new Promise<void>((done, fail) => {
    router.once("error", fail);
    router.listen(input.port, "127.0.0.1", done);
  });
  return {
    origin: `http://127.0.0.1:${input.port}`,
    workerOrigin,
    async close() {
      await new Promise<void>((done) => router.close(() => done()));
      router.closeAllConnections();
      stopWorker();
      await exitOf(worker);
    },
  };
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
]);

/** Route by path like Cloudflare does; keep the public Host so both sides see one origin. */
function createRouter(
  port: number,
  workerOrigin: string,
  portalUpstream: string,
  log: (text: string) => void,
): Server {
  const publicHost = `127.0.0.1:${port}`;
  return createServer((request: IncomingMessage, response: ServerResponse) => {
    const pathname = new URL(request.url ?? "/", "http://router.invalid").pathname;
    const target = new URL(routedToEdge(pathname) ? workerOrigin : portalUpstream);
    const headers: Record<string, string | string[]> = {};
    for (const [name, value] of Object.entries(request.headers)) {
      if (value !== undefined && !HOP_BY_HOP.has(name)) headers[name] = value;
    }
    headers.host = publicHost;
    const upstream = httpRequest(
      {
        host: target.hostname,
        port: target.port,
        method: request.method,
        path: request.url,
        headers,
      },
      (reply) => {
        const replyHeaders: Record<string, string | string[]> = {};
        for (const [name, value] of Object.entries(reply.headers)) {
          if (value !== undefined && !HOP_BY_HOP.has(name)) replyHeaders[name] = value;
        }
        response.writeHead(reply.statusCode ?? 502, reply.statusMessage, replyHeaders);
        response.flushHeaders();
        reply.pipe(response);
        reply.on("error", () => response.destroy());
      },
    );
    upstream.on("error", (error) => {
      log(`router: ${request.method} ${pathname} -> ${target.origin} failed: ${error.message}\n`);
      if (!response.headersSent)
        response.writeHead(502, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "upstream_unavailable" }));
    });
    request.on("aborted", () => upstream.destroy());
    request.pipe(upstream);
  });
}

function exitOf(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((done) => child.once("exit", () => done()));
}

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createNetServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => done(port));
    });
  });
}

/** The Worker answers every path with some status once workerd is up. */
async function waitForAnyResponse(origin: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`the edge Worker at ${origin} exited before it was ready`);
    try {
      await fetch(`${origin}/health`, { signal: AbortSignal.timeout(2_000) });
      return;
    } catch {
      // Still starting.
    }
    await delay(500);
  }
  throw new Error(`the edge Worker at ${origin} was not ready within 2 minutes`);
}
