#!/usr/bin/env node
// Journeys and the performance gate on the production Portal and on packed
// Vite and Next.js consumers, then the cold-load and long-turn capture.
import { join } from "node:path";
import {
  createHosts,
  playwright,
  root,
  startNextConsumer,
  startPortalHosts,
} from "./browser-hosts.mjs";

const output = join(root, "output/playwright/packed-consumers");
const hosts = createHosts(output);
try {
  const portal = await startPortalHosts(hosts);
  await startNextConsumer(hosts, portal);
  await playwright(
    hosts,
    ["--config=playwright.journeys.config.ts", "--retries=0"],
    {
      ...portal.env,
      JOURNEY_PORTAL_URL: portal.origins.portal,
      JOURNEY_EMBED_URL: portal.origins.consumer,
      JOURNEY_NEXT_URL: portal.origins.next,
    },
    // 18 journey tests and the performance gate on the Portal and mobile;
    // the 16 that are not Portal-only and the gate on each embed.
    72,
  );
  await hosts.run(
    "corepack",
    [
      "pnpm",
      "exec",
      "tsx",
      "scripts/performance/capture-ui.ts",
      "--url",
      portal.origins.portal,
      "--output",
      join(output, "performance"),
    ],
    portal.env,
  );
  console.log(`Packed consumers passed (consumer base ${portal.trustedBase}).`);
} finally {
  await hosts.stop();
}
