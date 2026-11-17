import type { AgentCard, ThreadCatalog } from "./";
const agent: AgentCard = {
  agent_id: 42,
  agent: "publisher/name",
  display_name: "Name",
  metadata: {},
};
const catalog: ThreadCatalog = {
  toolsets: [{ name: "default", display_name: "Default" }],
  packages: [],
};
void [agent, catalog];
