import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { sign } from "node:crypto";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const origin = "http://127.0.0.1:18080";
// Deliberate local fixture identity, not a Portal login. Never expose this server.
export default defineConfig({
  root: here,
  plugins: [
    react(),
    {
      name: "isolated-payment-account",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (!req.url?.startsWith("/v1/account/credits")) return next();
          if (
            req.headers.host !== "127.0.0.1:18080" ||
            (req.headers.origin && req.headers.origin !== origin)
          ) {
            res.statusCode = 403;
            return res.end();
          }
          if (
            !/^\/v1\/account\/credits(?:\/methods|\/purchases(?:\/[a-zA-Z0-9-]+(?:\/cancel)?)?)?(?:\?.*)?$/.test(
              req.url,
            )
          ) {
            res.statusCode = 404;
            return res.end();
          }
          try {
            const now = Math.floor(Date.now() / 1000);
            const encode = (value: object) =>
              Buffer.from(JSON.stringify(value)).toString("base64url");
            const data = `${encode({ alg: "EdDSA", typ: "JWT", kid: "aomi-bff-dev-1" })}.${encode({ iss: "aomi-bff", aud: "aomi-payment", sub: "checkout-e2e-20261023", role: "user", iat: now, exp: now + 60, scope: "account:credits:read account:credits:topup payments:submit", resource: `${origin}/v1/account`, principal_class: "user", auth_source: "session" })}`;
            const token = `${data}.${sign(null, Buffer.from(data), readFileSync(process.env.PAYMENT_E2E_KEY_FILE!)).toString("base64url")}`;
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(Buffer.from(chunk));
            const headers = new Headers({ authorization: `Bearer ${token}` });
            for (const key of [
              "content-type",
              "idempotency-key",
              "payment-signature",
            ]) {
              const value = req.headers[key];
              if (typeof value === "string") headers.set(key, value);
            }
            const upstream = await fetch(`http://127.0.0.1:18085${req.url}`, {
              method: req.method,
              headers,
              body: chunks.length ? Buffer.concat(chunks) : undefined,
            });
            res.statusCode = upstream.status;
            for (const key of [
              "content-type",
              "payment-required",
              "payment-response",
            ]) {
              const value = upstream.headers.get(key);
              if (value) res.setHeader(key, value);
            }
            res.end(Buffer.from(await upstream.arrayBuffer()));
          } catch {
            res.statusCode = 502;
            res.end('{"error":"Local Payment service unavailable"}');
          }
        });
      },
    },
  ],
  resolve: {
    alias: [
      { find: "@aomi-labs/react", replacement: `${here}runtime.ts` },
      { find: "@/wallet/context", replacement: `${here}wallet.ts` },
      {
        find: "@aomi-labs/client",
        replacement: `${here}../../../client/src/index.ts`,
      },
      { find: "@", replacement: `${here}../../src` },
    ],
  },
  css: { postcss: fileURLToPath(new URL("../../../../", import.meta.url)) },
  server: {
    host: "127.0.0.1",
    port: 18080,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL("../../../../", import.meta.url))] },
  },
});
