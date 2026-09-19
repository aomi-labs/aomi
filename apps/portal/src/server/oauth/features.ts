import "server-only";

function enabled(name: string, defaultValue: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return defaultValue;
  return value === "1" || value === "true" || value === "yes";
}

const guestRestDefault = process.env.NODE_ENV !== "production";

export const oauthFeatures = {
  agentGuestRest: () =>
    enabled("AOMI_GUEST_AGENT_REST_ENABLED", guestRestDefault),
  pipelineGuestRest: () =>
    enabled("AOMI_GUEST_PIPELINE_REST_ENABLED", guestRestDefault),
} as const;

export function isGuestRestEnabled(resource: string): boolean {
  return new URL(resource).pathname.includes("/v1/agent")
    ? oauthFeatures.agentGuestRest()
    : oauthFeatures.pipelineGuestRest();
}
