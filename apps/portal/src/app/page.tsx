import { McpAuthorizeResume } from "./mcp-authorize-resume";
import { SignInReturn } from "./sign-in-return";
import { PortalAomiFrame } from "@/components/shell/portal-aomi-frame";

export default function Home() {
  return (
    <>
      <McpAuthorizeResume />
      <SignInReturn />
      <PortalAomiFrame />
    </>
  );
}
