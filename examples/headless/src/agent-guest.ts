import { Aomi } from "@aomi-labs/client";

const baseUrl = process.env.AOMI_BASE_URL || "https://chat.aomi.dev";
const aomi = new Aomi({ baseUrl });
// Turn streams tool steps, not reply text. AgentRun exposes the live text
// through its session until the facade gains a text iterator.
const turn = aomi.agent.run("Introduce Aomi in one sentence.");
let printed = "";
const off = turn.session.subscribe(() => {
  const { liveMessages, messages } = turn.session.getSnapshot();
  const text = (liveMessages?.length ? liveMessages : messages)
    .filter((m) => m.sender === "agent" && !m.tool_result)
    .map((m) => m.content)
    .join("");
  if (text.startsWith(printed)) {
    process.stdout.write(text.slice(printed.length));
    printed = text;
  }
});
try {
  const { reply } = await turn;
  if (reply.startsWith(printed))
    process.stdout.write(reply.slice(printed.length));
  console.log();
} finally {
  off();
}
