// Long-running fake upstream for Playwright's webServer: `tsx serve.ts <port>`.
import { startAgentUpstream } from "./upstream";

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port <= 0)
  throw new Error("Pass the port the fake upstream listens on");
const upstream = await startAgentUpstream({ port });
console.log(`Fake upstream listening on ${upstream.origin}`);
