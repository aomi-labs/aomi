import { Aomi } from "@aomi-labs/client";

const baseUrl = process.env.AOMI_BASE_URL?.trim() || "http://localhost:3000";

// Guest identity and Auto agent routing are both defaults. In Node, the first
// request creates an anonymous Better Auth session and reuses its credential.
const aomi = new Aomi({ baseUrl });
const sessionId = crypto.randomUUID();

const result = await aomi.agent.run(
  "Introduce Aomi in one sentence for a TypeScript developer.",
  { sessionId },
);

// Pin a task only when your integration explicitly needs one app:
// await aomi.agent.run("Get a Uniswap quote", {
//   sessionId: crypto.randomUUID(),
//   target: { mode: "direct", app: "uniswap" },
// });
const reply = [...result.messages]
  .reverse()
  .find((message) => message.sender === "agent")?.content;

console.log(`Guest Agent session: ${result.sessionId}`);
console.log(reply ?? "The Agent returned no text.");
