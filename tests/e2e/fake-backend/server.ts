import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { FakeAgentBackend, type FakeResponse } from "./backend";

/**
 * Real local HTTP and SSE transport for one FakeAgentBackend. `routes` adds
 * fixed JSON answers by path, for hosts that have no Portal in front.
 */
export async function createFakeAgentServer(
  options: {
    backend?: FakeAgentBackend;
    port?: number;
    routes?: Record<string, unknown>;
  } = {},
) {
  const backend = options.backend ?? new FakeAgentBackend();
  const streams = new Set<ServerResponse>();
  const server = createServer(async (request, response) => {
    const origin = request.headers.origin;
    // Loopback only. CORS may expose fake agent data, never auth.
    if (origin) {
      response.setHeader("access-control-allow-origin", origin);
      response.setHeader("access-control-allow-credentials", "true");
      response.setHeader("vary", "Origin");
      response.setHeader(
        "access-control-allow-headers",
        request.headers["access-control-request-headers"] ??
          "accept,authorization,content-type,idempotency-key,payment-signature,x-session-id",
      );
      response.setHeader(
        "access-control-expose-headers",
        "payment-required,retry-after",
      );
      response.setHeader(
        "access-control-allow-methods",
        "GET,POST,PATCH,DELETE,OPTIONS",
      );
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    try {
      const path = new URL(request.url ?? "/", "http://fixture.invalid")
        .pathname;
      const fixed = options.routes?.[path];
      if (fixed !== undefined) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(fixed));
        return;
      }
      const text = await readBody(request);
      const result = await backend.handle({
        method: request.method ?? "GET",
        url: new URL(request.url ?? "/", "http://fixture.invalid"),
        headers: Object.fromEntries(
          Object.entries(request.headers).map(([name, value]) => [
            name,
            Array.isArray(value) ? value.join(",") : value,
          ]),
        ),
        body: text ? JSON.parse(text) : undefined,
      });
      sendFakeResponse(backend, result, response, streams);
    } catch {
      if (!response.headersSent)
        response.writeHead(500, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          error: { code: "fixture_failure", message: "Agent fixture failed" },
        }),
      );
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No fixture port");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    backend,
    async close() {
      for (const response of streams) response.end();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

export async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

export function sendFakeResponse(
  backend: FakeAgentBackend,
  result: FakeResponse,
  response: ServerResponse,
  streams: Set<ServerResponse>,
) {
  if (result.kind === "stream") {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    });
    const detach = backend.openStream(
      result.sessionId,
      result.cursor,
      (chunk) => response.write(chunk),
    );
    streams.add(response);
    response.on("close", () => {
      detach();
      streams.delete(response);
    });
    return;
  }
  response.writeHead(result.status, {
    "content-type": "application/json",
    ...result.headers,
  });
  response.end(result.status === 204 ? undefined : JSON.stringify(result.body));
}
