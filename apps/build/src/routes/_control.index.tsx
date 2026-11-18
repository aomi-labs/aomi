import { createFileRoute } from "@tanstack/react-router";

import { OverviewView } from "@/features/packages/overview-view";

export const Route = createFileRoute("/_control/")({
  component: OverviewView,
});
