import { createFileRoute } from "@tanstack/react-router";
import { PortalAomiFrame } from "@/components/shell/portal-aomi-frame";
import { McpAuthorizeResume } from "@/features/oauth/mcp-authorize-resume";

export const Route = createFileRoute("/")({
  component: () => (
    <>
      <McpAuthorizeResume />
      <PortalAomiFrame />
    </>
  ),
});
