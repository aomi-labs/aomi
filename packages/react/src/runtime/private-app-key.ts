import { type AgentTarget, extractCapabilityHints } from "@aomi-labs/client";

/** A credential belongs to the exact Direct target or explicitly mentioned app. */
export function privateAppKey(
  target: AgentTarget,
  text: string | undefined,
  getKey: (id: string | number) => string | undefined,
  isPrivate: (id: string) => boolean = () => false,
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
  // Count private mentions, not stored keys: a second private app without a
  // key must still stop the send rather than ride on the first app's key.
  const privateIds = [...ids].filter(
    (id) => getKey(id) !== undefined || isPrivate(id),
  );
  if (privateIds.length > 1)
    throw new Error(
      "Choose one private app per message so its key can be used.",
    );
  return privateIds[0] === undefined ? undefined : getKey(privateIds[0]);
}
