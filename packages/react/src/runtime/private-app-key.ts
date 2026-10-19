import type { AgentTarget } from "@aomi-labs/client";
import { extractCapabilityHints } from "./capability-hints";

/** A credential belongs to the exact Direct target or explicitly mentioned app. */
export function privateAppKey(
  target: AgentTarget,
  text: string | undefined,
  getKey: (id: string | number) => string | undefined,
): string | undefined {
  if (target.mode === "direct")
    return target.applicationId != null
      ? getKey(target.applicationId)
      : undefined;
  const ids = new Set(
    extractCapabilityHints(text ?? "")
      .filter(
        (hint) => hint.kind === "app" && hint.id.startsWith("application:"),
      )
      .map((hint) => hint.id.slice("application:".length)),
  );
  const keys = [...ids].map(getKey).filter((key) => key !== undefined);
  if (keys.length > 1)
    throw new Error(
      "Choose one private app per message so its key can be used.",
    );
  return keys[0];
}
