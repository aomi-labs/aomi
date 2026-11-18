import type { FC, SVGProps } from "react";
import { Globe2Icon } from "lucide-react";

import { canonicalAgentId } from "@aomi-labs/client";

import { AutoModeIcon } from "./auto-mode";
import { SolanaIcon } from "./chain-icons";

type AgentIcon = FC<SVGProps<SVGSVGElement>>;

function WorldMarketsIcon(props: SVGProps<SVGSVGElement>) {
  return <Globe2Icon aria-hidden="true" {...props} />;
}

export function AllAgentsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      {/* Grid of 4 rounded squares — clean agent-grid icon */}
      <rect x="3" y="3" width="8" height="8" rx="2" fill="currentColor" />
      <rect
        x="13"
        y="3"
        width="8"
        height="8"
        rx="2"
        fill="currentColor"
        opacity="0.55"
      />
      <rect
        x="3"
        y="13"
        width="8"
        height="8"
        rx="2"
        fill="currentColor"
        opacity="0.55"
      />
      <rect x="13" y="13" width="8" height="8" rx="2" fill="currentColor" />
    </svg>
  );
}

/**
 * Marks for Aomi's own modes and built-in toolsets. Packages are not here:
 * a package draws its own `icon_url` (`PackageMark`).
 */
const AGENT_ICONS: Readonly<Record<string, AgentIcon>> = {
  default: AllAgentsIcon,
  auto: AutoModeIcon,
  orchestrator: AutoModeIcon,
  svm: SolanaIcon,
  "svm-transfer": SolanaIcon,
  "world-markets": WorldMarketsIcon,
};

export function getAgentIcon(
  agentScope: string | null | undefined,
): AgentIcon | undefined {
  const canonicalId = canonicalAgentId(agentScope);
  return Object.hasOwn(AGENT_ICONS, canonicalId)
    ? AGENT_ICONS[canonicalId]
    : undefined;
}
