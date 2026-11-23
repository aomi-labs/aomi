import { type AgentTarget, extractCapabilityHints } from "@aomi-labs/client";

export function privateAgentKey(
  target: AgentTarget,
  text: string | undefined,
  getKey: (slug: string) => string | undefined,
  isPrivate: (slug: string) => boolean = () => false,
): string | undefined {
  if (target.agent) return getKey(target.agent);
  const agents = new Set(
    extractCapabilityHints(text ?? "")
      .filter((hint) => hint.kind === "agent" && hint.id.startsWith("agent:"))
      .map((hint) => hint.id.slice(6))
      .filter((slug) => getKey(slug) !== undefined || isPrivate(slug)),
  );
  if (agents.size > 1)
    throw new Error(
      "Choose one private agent per message so its key can be used.",
    );
  const slug = [...agents][0];
  return slug ? getKey(slug) : undefined;
}
