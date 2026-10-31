import { createFileRoute } from "@tanstack/react-router";
import { BuildView } from "@/features/build/build-view";

export const Route = createFileRoute("/_control/build")({
  component: BuildPage,
});

function BuildPage() {
  return <BuildView />;
}
