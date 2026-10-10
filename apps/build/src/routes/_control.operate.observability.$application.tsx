import { createFileRoute } from "@tanstack/react-router";
import { notFound } from "@tanstack/react-router";
import { AppDetailPage } from "@/features/operate/app-detail-page";

export const Route = createFileRoute(
  "/_control/operate/observability/$application",
)({
  component: OperateObservabilityDetailPage,
});

function OperateObservabilityDetailPage() {
  const { application } = Route.useParams();
  const applicationId = Number(application);
  if (!Number.isSafeInteger(applicationId) || applicationId <= 0) {
    throw notFound();
  }

  return <AppDetailPage applicationId={applicationId} />;
}
