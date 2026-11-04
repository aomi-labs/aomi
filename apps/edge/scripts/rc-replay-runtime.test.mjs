// @vitest-environment node
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { unstable_dev } from "wrangler";

let worker;
beforeAll(async () => {
  // wrangler.rc.jsonc binds the account database; this replay test never connects to it.
  process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE ??= "postgres://unused:unused@127.0.0.1:9/unused";
  worker = await unstable_dev(fileURLToPath(new URL("./fixtures/rc-replay-worker.ts", import.meta.url)), {
    config: fileURLToPath(new URL("../wrangler.rc.jsonc", import.meta.url)),
    local: true,
    ip: "127.0.0.1",
    port: 0,
    inspectorPort: 0,
    persist: false,
    logLevel: "error",
    experimental: { disableExperimentalWarning: true, disableDevRegistry: true },
  });
}, 60000);
afterAll(async () => { await worker?.stop(); });

it("atomically consumes a JTI across concurrent workerd requests and rejects later replay", async () => {
  const body = JSON.stringify({ jti: crypto.randomUUID(), expiresAt: Date.now() + 60000 });
  const claim = async () => (await worker.fetch("/", { method: "POST", body })).status;
  const statuses = await Promise.all(Array.from({ length: 20 }, claim));
  expect(statuses.filter((status) => status === 204)).toHaveLength(1);
  expect(statuses.filter((status) => status === 409)).toHaveLength(19);
  expect(await claim()).toBe(409);
}, 30000);
