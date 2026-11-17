import { createFileRoute, notFound } from "@tanstack/react-router";
import { AgentDetailPage } from "@/features/operate/agent-detail-page";

export const Route = createFileRoute("/_control/operate/observability/$agent")({
  beforeLoad: ({ params }) => {
    const agentId = Number(params.agent);
    if (!Number.isSafeInteger(agentId) || agentId <= 0) throw notFound();
  },
  component: OperateObservabilityDetailPage,
});

function OperateObservabilityDetailPage() {
  const { agent } = Route.useParams();
  return <AgentDetailPage agentId={Number(agent)} />;
}
