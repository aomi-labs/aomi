import { createFileRoute } from "@tanstack/react-router";
import IntegrationsPreview from "@/features/dev/integrations-preview";

export const Route = createFileRoute("/dev/integrations-preview")({
  component: IntegrationsPreview,
});
