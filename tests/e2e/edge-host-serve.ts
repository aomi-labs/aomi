// Long-running edge host for Playwright's webServer:
//   tsx edge-host-serve.ts --port 3460 --portal http://127.0.0.1:3463 \
//     --upstream http://127.0.0.1:3462 --trusted http://127.0.0.1:3461[,…]
import { startEdgeHost } from "./edge-host";

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function requiredFlag(name: string): string {
  const value = flag(name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

const port = Number(requiredFlag("port"));
if (!Number.isInteger(port) || port <= 0)
  throw new Error("--port must be the public portal port");

const host = await startEdgeHost({
  port,
  portalUpstream: requiredFlag("portal"),
  agentUpstream: requiredFlag("upstream"),
  trustedOrigins: (flag("trusted") ?? "").split(",").filter(Boolean),
  databaseUrl: process.env.AOMI_TEST_DATABASE_URL ?? "",
  log: (text) => process.stdout.write(text),
});
console.log(
  `Edge host listening on ${host.origin} (Worker ${host.workerOrigin}, portal ${requiredFlag("portal")})`,
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void host.close().finally(() => process.exit(0));
  });
