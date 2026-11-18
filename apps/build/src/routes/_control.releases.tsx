import { createFileRoute } from "@tanstack/react-router";

import { ReleasesView } from "@/features/packages/releases-view";

export const Route = createFileRoute("/_control/releases")({
  component: ReleasesView,
});
