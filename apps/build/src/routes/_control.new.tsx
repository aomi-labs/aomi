import { createFileRoute } from "@tanstack/react-router";

import { NewView } from "@/features/packages/new-view";

export const Route = createFileRoute("/_control/new")({
  component: NewView,
});
