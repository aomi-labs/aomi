import { createFileRoute, notFound } from "@tanstack/react-router";
import { WidgetAuthE2EClient } from "@/features/dev/widget-auth-e2e-client";

export const Route = createFileRoute("/dev/widget-auth-e2e")({
  beforeLoad: () => {
    if (import.meta.env.PROD) throw notFound();
  },
  component: WidgetAuthE2EClient,
});
