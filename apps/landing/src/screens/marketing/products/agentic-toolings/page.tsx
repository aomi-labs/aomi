import type {LandingMetadata as Metadata} from "@/lib/metadata";
import { AgentToolingsPageContent } from "../../../marketing-templates/products/cli-mcp/page";
import toolingStyles from "../../../marketing-templates/products/cli-mcp/agentic-surfaces.module.css";

export const metadata: Metadata = {
  title: "Agent Toolings | Aomi",
  description:
    "Connect existing agents through Skills, hosted MCP, or the Aomi CLI over one account-owned execution harness.",
  robots: { index: false, follow: false },
};

export default function AgentToolingsPage() {
  return (
    <div className={toolingStyles.marketingTokens}>
      <AgentToolingsPageContent productName="Agent Toolings" />
    </div>
  );
}
