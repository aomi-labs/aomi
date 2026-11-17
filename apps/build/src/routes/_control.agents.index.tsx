import { createFileRoute } from "@tanstack/react-router";

import { InventoryView } from "@/features/packages/inventory-view";

export const Route = createFileRoute("/_control/agents/")({
  component: () => <InventoryView only="agents" />,
});
