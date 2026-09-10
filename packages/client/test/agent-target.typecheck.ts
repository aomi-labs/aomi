import type { AgentRunOptions, AgentTarget, SessionOptions } from "../src";

const auto: AgentTarget = { mode: "auto" };
const implicitAuto: AgentTarget = {};
const directDefault: AgentTarget = { mode: "direct" };
const directBuiltin: AgentTarget = { mode: "direct", app: "zerox" };
const directHosted: AgentTarget = { mode: "direct", applicationId: 42 };
const directHostedChecked: AgentTarget = {
  mode: "direct",
  applicationId: 42,
  app: "partner",
};

const sessionOptions: SessionOptions = { target: auto };
const runOptions: AgentRunOptions = { target: directBuiltin };
void [
  implicitAuto,
  directDefault,
  directHosted,
  directHostedChecked,
  sessionOptions,
  runOptions,
];

// @ts-expect-error Auto cannot carry an app target.
const invalidAuto: AgentTarget = { mode: "auto", app: "zerox" };
// @ts-expect-error Hosted Direct identities are numeric.
const invalidDirect: AgentTarget = { mode: "direct", applicationId: "42" };
void [invalidAuto, invalidDirect];
