// Disposable loopback acceptance environment. Never point at a hosted database.
const databaseUrl = process.env.ACCOUNT_CHOICE_DATABASE_URL;
if (
  !databaseUrl ||
  process.env.AOMI_TEST_DATABASE_DISPOSABLE !== "1" ||
  !["127.0.0.1", "localhost", "[::1]"].includes(new URL(databaseUrl).hostname)
) {
  throw new Error(
    "Require ACCOUNT_CHOICE_DATABASE_URL on loopback and AOMI_TEST_DATABASE_DISPOSABLE=1",
  );
}
import { spawn } from "node:child_process";
import { startAgentUpstream } from "./fake-backend/upstream";
import { portalEnv } from "./portal-env";
const upstream = await startAgentUpstream({});
console.log("Disposable upstream:", upstream.origin);
const env = {
  ...process.env,
  ...portalEnv({
    portal: "http://127.0.0.1:3417",
    upstream: upstream.origin,
    databaseUrl: databaseUrl,
    embedOrigins: ["http://127.0.0.1:3418", "http://127.0.0.1:3420"],
  }),
  AOMI_TEST_DATABASE_DISPOSABLE: "1",
};
const app = spawn(
  "corepack",
  [
    "pnpm",
    "--filter",
    "portal",
    "exec",
    "next",
    "dev",
    "-H",
    "127.0.0.1",
    "-p",
    "3417",
  ],
  { env, stdio: "inherit" },
);
process.on("SIGTERM", () => {
  app.kill();
  void upstream.close();
  process.exit(0);
});
await new Promise((resolve) => app.on("exit", resolve));
