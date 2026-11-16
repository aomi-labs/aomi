import { createFileRoute } from "@tanstack/react-router";

import { PackageDetailView } from "@/features/packages/package-detail-view";

export const Route = createFileRoute("/_control/packages/$name")({
  component: function PackagePage() {
    return <PackageDetailView name={Route.useParams().name} />;
  },
});
