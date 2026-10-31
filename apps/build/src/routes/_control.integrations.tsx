import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { IntegrationsView } from "@/features/integrations/integrations-view";

export const Route = createFileRoute("/_control/integrations")({
  component: IntegrationsPage,
});

function IntegrationsPage() {
  return (
    <Suspense fallback={null}>
      <IntegrationsView />
    </Suspense>
  );
}
