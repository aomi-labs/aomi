import type { AgentRunOptions, AgentTarget, SessionOptions } from "./";
const main: AgentTarget = {};
const named: AgentTarget = { agent: "publisher/name" };
const session: SessionOptions = { target: named };
const run: AgentRunOptions = { target: main };
// @ts-expect-error Slugs are strings.
const invalid: AgentTarget = { agent: 42 };
// @ts-expect-error Turns name an agent; there is no mode.
const moded: AgentTarget = { mode: "direct" };
void [session, run, invalid, moded];
