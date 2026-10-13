import { McpAuthorizeResume } from "@/features/oauth/mcp-authorize-resume";
import { PortalAomiFrame } from "@/components/shell/portal-aomi-frame";

export default function Home() {
  return (
    <>
      <McpAuthorizeResume />
      <PortalAomiFrame />
    </>
  );
}
