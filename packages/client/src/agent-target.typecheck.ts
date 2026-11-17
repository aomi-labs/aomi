import type { AgentRunOptions, AgentTarget, SessionOptions } from "./";
const auto: AgentTarget = { mode: "auto" };
const direct: AgentTarget = { mode: "direct", agent: "publisher/name" };
const session: SessionOptions = { target: direct };
const run: AgentRunOptions = { target: auto };
// @ts-expect-error Slugs are strings.
const invalid: AgentTarget = { mode: "direct", agent: 42 };
void [session, run, invalid];
