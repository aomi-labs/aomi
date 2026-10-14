import { Suspense } from "react";
import { IntegrationsView } from "@/features/integrations/integrations-view";

export default function IntegrationsPage() {
  return (
    <Suspense fallback={null}>
      <IntegrationsView />
    </Suspense>
  );
}
