#!/usr/bin/env node
// Real-auth browser contracts: production Portal, real Better Auth on a
// disposable database, and the packed Vite consumer on a second origin.
// Extra arguments go to Playwright (for example --update-snapshots).
import { join } from "node:path";
import {
  createHosts,
  playwright,
  root,
  startPortalHosts,
} from "./browser-hosts.mjs";

const { fixtureKeys } = await import("../tests/e2e/fixture-wallets.ts");
const extraArgs = process.argv.slice(2);
if (process.env.CI && extraArgs.includes("--update-snapshots"))
  throw new Error("CI cannot update committed browser snapshots");

const hosts = createHosts(join(root, "output/playwright/browser-contracts"));
try {
  const portal = await startPortalHosts(hosts, {
    transactionFrom: fixtureKeys.evmAddress,
  });
  await playwright(
    hosts,
    ["--project=browser-contracts", "--retries=0", ...extraArgs],
    {
      ...portal.env,
      BROWSER_CONTRACT_PORTAL_URL: portal.origins.portal,
      BROWSER_CONTRACT_CONSUMER_URL: portal.origins.consumer,
      BROWSER_CONTRACT_REJECTED_CONSUMER_URL: portal.origins.rejectedConsumer,
      BROWSER_CONTRACT_UPSTREAM_URL: portal.upstream,
    },
    extraArgs.length ? 1 : 16,
  );
  console.log(
    `Browser contracts passed against the consumer from ${portal.trustedBase}.`,
  );
} finally {
  await hosts.stop();
}
