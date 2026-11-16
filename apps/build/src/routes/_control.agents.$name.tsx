import { createFileRoute } from "@tanstack/react-router";

import { AgentDetailView } from "@/features/packages/agent-detail-view";

export const Route = createFileRoute("/_control/agents/$name")({
  component: function AgentPage() {
    return <AgentDetailView name={Route.useParams().name} />;
  },
});
