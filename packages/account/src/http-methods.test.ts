// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { installNativeHttpMethods } from "./http-methods";

type NativeHandler = (input: { request: Request }) => Response;

function nativeRoute(handlers: Record<string, NativeHandler>) {
  return { options: { server: { handlers } } };
}

function request(method: string) {
  return { request: new Request("http://localhost/api/test", { method }) };
}

describe("installNativeHttpMethods", () => {
  it("answers implicit preflight without invoking the declared handlers", async () => {
    const GET = vi.fn(() => new Response("authenticated result"));
    const POST = vi.fn(() => new Response("created"));
    const route = nativeRoute({ GET, POST });

    installNativeHttpMethods(route);

    const response = route.options.server.handlers.OPTIONS(request("OPTIONS"));
    expect(response.status).toBe(204);
    expect(response.headers.get("Allow")).toBe("GET, HEAD, OPTIONS, POST");
    expect(response.body).toBeNull();
    expect(await response.text()).toBe("");
    expect(GET).not.toHaveBeenCalled();
    expect(POST).not.toHaveBeenCalled();
    expect(route.options.server.handlers.GET).toBe(GET);
    expect(route.options.server.handlers.HEAD).toBeUndefined();
  });

  it("rejects undeclared verbs on a POST-only route without advertising HEAD", () => {
    const POST = vi.fn(() => new Response("created"));
    const route = nativeRoute({ POST });

    installNativeHttpMethods(route);

    const handlers = route.options.server.handlers;
    expect(handlers.OPTIONS(request("OPTIONS")).headers.get("Allow")).toBe(
      "OPTIONS, POST",
    );
    for (const method of ["GET", "HEAD", "PUT", "PATCH", "DELETE"]) {
      const response = handlers.ANY(request(method));
      expect(response.status).toBe(405);
      expect(response.headers.has("Allow")).toBe(false);
      expect(response.body).toBeNull();
    }
    expect(POST).not.toHaveBeenCalled();
  });

  it("returns 400 for a method outside the supported route verbs", () => {
    const route = nativeRoute({ GET: () => new Response("result") });
    installNativeHttpMethods(route);

    const response = route.options.server.handlers.ANY(request("PROPFIND"));
    expect(response.status).toBe(400);
    expect(response.body).toBeNull();
  });

  it("retains explicit OPTIONS, HEAD and ANY handlers and their response policies", () => {
    const OPTIONS = vi.fn(
      () =>
        new Response(null, {
          status: 403,
          headers: { "Access-Control-Allow-Origin": "https://allowed.example" },
        }),
    );
    const HEAD = vi.fn(
      () =>
        new Response(null, { status: 202, headers: { "X-Head": "explicit" } }),
    );
    const ANY = vi.fn(() => new Response(null, { status: 418 }));
    const route = nativeRoute({ OPTIONS, HEAD, ANY });

    installNativeHttpMethods(route);

    const handlers = route.options.server.handlers;
    expect(handlers.OPTIONS).toBe(OPTIONS);
    expect(handlers.HEAD).toBe(HEAD);
    expect(handlers.ANY).toBe(ANY);
    const preflight = handlers.OPTIONS(request("OPTIONS"));
    expect(preflight.status).toBe(403);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://allowed.example",
    );
    expect(preflight.headers.has("Allow")).toBe(false);
    const head = handlers.HEAD(request("HEAD"));
    expect(head.status).toBe(202);
    expect(head.headers.get("X-Head")).toBe("explicit");
    expect(handlers.ANY(request("DELETE")).status).toBe(418);
  });

  it("sorts all declared verbs and includes an explicit HEAD only once", () => {
    const handler = () => new Response(null);
    const route = nativeRoute({
      PATCH: handler,
      HEAD: handler,
      DELETE: handler,
      PUT: handler,
      POST: handler,
      GET: handler,
    });
    installNativeHttpMethods(route);

    expect(
      route.options.server.handlers
        .OPTIONS(request("OPTIONS"))
        .headers.get("Allow"),
    ).toBe("DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT");
  });

  it("walks nested route children without adding handlers to page-only routes", () => {
    const child = nativeRoute({ POST: () => new Response("created") });
    const page = {
      options: { server: undefined, component: vi.fn() },
      children: [child],
    };
    const root = { options: {}, children: { page } };

    installNativeHttpMethods(root);

    expect(root.options).toEqual({});
    expect(page.options.server).toBeUndefined();
    expect(page.options.component).not.toHaveBeenCalled();
    expect(child.options.server.handlers.ANY(request("GET")).status).toBe(405);
  });

  it("keeps installed handler identities and Allow values stable on repeated initialization", () => {
    const route = nativeRoute({ GET: () => new Response("result") });
    installNativeHttpMethods(route);
    const { OPTIONS, ANY } = route.options.server.handlers;

    installNativeHttpMethods(route);

    expect(route.options.server.handlers.OPTIONS).toBe(OPTIONS);
    expect(route.options.server.handlers.ANY).toBe(ANY);
    expect(OPTIONS(request("OPTIONS")).headers.get("Allow")).toBe(
      "GET, HEAD, OPTIONS",
    );
  });
});
