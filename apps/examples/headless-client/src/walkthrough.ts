/**
 * Aomi TypeScript client walkthrough
 *
 * This is intentionally one linear script: no framework, no TUI, no wallet,
 * and no hidden helpers. Run it, then read it from top to bottom.
 */

import { Aomi, type MessageEvent } from "@aomi-labs/client";

const baseUrl = process.env.AOMI_BASE_URL?.trim() || "http://localhost:3000";

// 1. Create one SDK facade.
//
// With only `baseUrl`, guest mode is on by default. The client creates one
// Better Auth anonymous session on the first request, keeps its opaque session
// bearer in memory in Node, and reuses it. There is no API key setup step.
// Public `/v1` account login is a separate OAuth or first-party session
// concern; this walkthrough intentionally demonstrates the working guest path.
const aomi = new Aomi({ baseUrl });

console.log("1. Client created");
console.log(`   API: ${baseUrl}`);
console.log("   Auth: automatic guest");

// 2. Pick a session ID in your application and persist it with the chat.
// Passing the same ID to later runs gives the Agent the same conversation.
const sessionId = crypto.randomUUID();

console.log("\n2. First Agent turn");
const first = await aomi.agent.run(
  "Remember that the demo word is cobalt. Reply with only: remembered.",
  { sessionId },
);
console.log(`   aomi> ${lastAgentText(first.messages)}`);

console.log("\n3. Second Agent turn, same session ID");
const second = await aomi.agent.run("What is the demo word?", {
  sessionId,
});
console.log(`   aomi> ${lastAgentText(second.messages)}`);
console.log(`   sessionId: ${second.sessionId}`);

// 3. Session management lives on the wire-close `raw` client. The friendly
// facade and raw transport share the same auth and underlying client instance.
const sessions = aomi.raw.agent.sessions;
const stored = await sessions.get(sessionId);
console.log("\n4. Stored session");
console.log(`   title: ${stored.title ?? "(untitled)"}`);

const renamed = await sessions.update(sessionId, {
  title: "TypeScript client walkthrough",
});
console.log(`   renamed: ${renamed.title}`);

const page = await sessions.list({ limit: 10 });
console.log(`   visible sessions: ${page.sessions.length}`);

// These are the remaining lifecycle calls; leave them commented so the new
// session remains available for inspection after the walkthrough finishes.
// await sessions.update(sessionId, { archived: true });
// await sessions.delete(sessionId);

// 4. Account identity is separate from the Agent session and from a wallet.
// A guest normally returns `null`. Connecting an onchain wallet does not
// silently create an account.
const account = await aomi.raw.fetchAccountProfile(sessionId);
console.log("\n5. Account");
console.log(
  account
    ? `   signed in as ${account.user.username ?? account.user.user_id}`
    : "   guest (no full account profile)",
);

// 5. Pipeline is a catalog + deterministic Build lifecycle on the same facade.
// Listing the app and skill directories is read-only and lets an integrator
// discover the live catalog instead of hard-coding a second registry.
const [apps, skills] = await Promise.all([
  aomi.raw.pipeline.apps.list(),
  aomi.raw.pipeline.skills.list(),
]);
console.log("\n6. Pipeline catalog");
for (const entry of apps.entries.slice(0, 4)) {
  console.log(`   app       ${entry.name}`);
}
for (const entry of skills.entries.slice(0, 4)) {
  console.log(`   skill     ${entry.name}`);
}

// Optionally demonstrate a real catalog operation. The high-level build call:
//   - loads the operation's live JSON Schema,
//   - validates these arguments,
//   - builds the chain action,
//   - simulates it,
//   - returns a reviewable object.
//
// It does NOT commit. `await build.commit()` is always a separate explicit
// boundary and is deliberately absent from this walkthrough.
const pipelineApp = process.env.AOMI_PIPELINE_APP?.trim();
const pipelineOperation = process.env.AOMI_PIPELINE_OPERATION?.trim();
const pipelineArgs = process.env.AOMI_PIPELINE_ARGS?.trim();

if (pipelineApp && pipelineOperation && pipelineArgs) {
  const args = parseArguments(pipelineArgs);
  const operation = await aomi.pipeline
    .app(pipelineApp)
    .operation(pipelineOperation);
  console.log(`\n7. Pipeline operation: ${operation.name}`);
  console.log(`   ${operation.description}`);

  const build = await aomi.pipeline
    .app(pipelineApp)
    .build(pipelineOperation, args);
  console.log(`   status: ${build.status}`);
  console.log(`   simulation: ${build.simulation.status}`);
  console.log(`   actions: ${build.actions.length}`);
  console.log("   commit: skipped (review boundary stays explicit)");
} else {
  console.log("\n7. Pipeline build skipped");
  console.log(
    "   Set AOMI_PIPELINE_APP, AOMI_PIPELINE_OPERATION, and AOMI_PIPELINE_ARGS to run it.",
  );
}

console.log("\nDone.");

function lastAgentText(messages: readonly MessageEvent[]): string {
  return (
    [...messages]
      .reverse()
      .find((message) => message.sender === "agent")
      ?.content?.trim() || "(no agent message)"
  );
}

function parseArguments(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("AOMI_PIPELINE_ARGS must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}
