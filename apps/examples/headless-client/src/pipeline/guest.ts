import { Aomi } from "@aomi-labs/client";

const baseUrl = process.env.AOMI_BASE_URL?.trim() || "http://localhost:3000";

// Guest mode can inspect and execute self-custodial Pipeline operations
// without an OAuth client. Payments and delegated custody still require an
// authenticated account grant.
const aomi = new Aomi({ baseUrl });
const [apps, skills] = await Promise.all([
  aomi.raw.pipeline.apps.list(),
  aomi.raw.pipeline.skills.list(),
]);

console.log(`Guest-visible Pipeline apps: ${apps.entries.length}`);
console.log(`Guest-visible Pipeline skills: ${skills.entries.length}`);
