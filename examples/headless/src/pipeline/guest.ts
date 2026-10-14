import { Aomi, PipelineApiError } from "@aomi-labs/client";

const baseUrl = process.env.AOMI_BASE_URL?.trim() || "https://chat.aomi.dev";

// Guest Pipeline availability is a deployment policy. Payments and delegated
// custody still require an authenticated account grant where guests are on.
const aomi = new Aomi({ baseUrl });
let apps;
let skills;
try {
  [apps, skills] = await Promise.all([
    aomi.raw.pipeline.apps.list(),
    aomi.raw.pipeline.skills.list(),
  ]);
} catch (error) {
  if (
    error instanceof PipelineApiError &&
    error.status === 403 &&
    error.code === "insufficient_scope"
  ) {
    throw new Error(
      "Guest Pipeline access is disabled on this deployment. Use the OAuth example with an authorized account.",
      { cause: error },
    );
  }
  throw error;
}

console.log(`Guest-visible Pipeline apps: ${apps.entries.length}`);
console.log(`Guest-visible Pipeline skills: ${skills.entries.length}`);
