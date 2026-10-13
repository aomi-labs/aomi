import { createFileRoute } from "@tanstack/react-router";

const proxy = async ({ request }: { request: Request }) => {
  const { proxyApiRequest } = await import("@/server/api-proxy");
  return proxyApiRequest(request);
};

export const Route = createFileRoute("/api/proxy")({
  server: {
    handlers: {
      GET: proxy,
      POST: proxy,
      PUT: proxy,
      PATCH: proxy,
      DELETE: proxy,
    },
  },
});
