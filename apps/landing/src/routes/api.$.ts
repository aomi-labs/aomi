import { createFileRoute } from "@tanstack/react-router";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

const forward =
  (method: Method) =>
  async ({
    request,
    params,
  }: {
    request: Request;
    params: { _splat?: string };
  }) => {
    const handler = await import("@/server/backend-proxy");
    return handler[method](request, {
      params: { slug: params._splat?.split("/").filter(Boolean) ?? [] },
    });
  };

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET: forward("GET"),
      POST: forward("POST"),
      PUT: forward("PUT"),
      PATCH: forward("PATCH"),
      DELETE: forward("DELETE"),
    },
  },
});
