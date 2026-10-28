import { createFileRoute, notFound } from "@tanstack/react-router";
import { AppDetailPage } from "@/features/operate/app-detail-page";

export const Route = createFileRoute(
  "/_control/operate/observability/$application",
)({
  beforeLoad: ({ params }) => {
    const applicationId = Number(params.application);
    if (!Number.isSafeInteger(applicationId) || applicationId <= 0)
      throw notFound();
  },
  component: OperateObservabilityDetailPage,
});

function OperateObservabilityDetailPage() {
  const { application } = Route.useParams();
  return <AppDetailPage applicationId={Number(application)} />;
}
