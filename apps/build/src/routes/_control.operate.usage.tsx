import { createFileRoute } from "@tanstack/react-router";

import { UsageView } from "@/features/packages/usage-view";

export const Route = createFileRoute("/_control/operate/usage")({
  component: UsageView,
});
