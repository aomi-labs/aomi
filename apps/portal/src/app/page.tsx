import { McpAuthorizeResume } from "./mcp-authorize-resume";
import { PortalAomiFrame } from "@portal/components/shell/portal-aomi-frame";

export default function Home() {
  return (
    <>
      <McpAuthorizeResume />
      <PortalAomiFrame />
    </>
  );
}
