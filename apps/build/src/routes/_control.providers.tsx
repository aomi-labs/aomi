import { createFileRoute } from "@tanstack/react-router";
import { ProvidersView } from "@/features/operate/providers-view";

export const Route = createFileRoute("/_control/providers")({
  component: ProvidersPage,
});

function ProvidersPage() {
  return <ProvidersView />;
}
