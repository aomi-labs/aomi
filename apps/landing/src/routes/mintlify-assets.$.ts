import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/mintlify-assets/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { proxyMintlify } = await import("@/server/http/mintlify");
        return proxyMintlify(request);
      },
      HEAD: async ({ request }) => {
        const { proxyMintlify } = await import("@/server/http/mintlify");
        return proxyMintlify(request);
      },
      POST: async ({ request }) => {
        const { proxyMintlify } = await import("@/server/http/mintlify");
        return proxyMintlify(request);
      },
      PUT: async ({ request }) => {
        const { proxyMintlify } = await import("@/server/http/mintlify");
        return proxyMintlify(request);
      },
      PATCH: async ({ request }) => {
        const { proxyMintlify } = await import("@/server/http/mintlify");
        return proxyMintlify(request);
      },
      DELETE: async ({ request }) => {
        const { proxyMintlify } = await import("@/server/http/mintlify");
        return proxyMintlify(request);
      },
      OPTIONS: async ({ request }) => {
        const { proxyMintlify } = await import("@/server/http/mintlify");
        return proxyMintlify(request);
      },
    },
  },
});
