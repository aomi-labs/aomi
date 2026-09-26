import type { Event } from "../agent/types";
import type { ResourceDescriptor } from "./types";

/** A compact, issued resource identity; reads still require authorization. */
export type ResourceLink = Pick<ResourceDescriptor, "uri" | "kind"> &
  Partial<Pick<ResourceDescriptor, "name">>;

export type ResourceResult = {
  resource: ResourceLink;
  summary: unknown;
  resources: Record<string, ResourceLink | ResourceLink[]>;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Recognize only a declared result envelope, never arbitrary URI-looking fields. */
export function parseResourceResult(
  value: unknown,
): ResourceResult | undefined {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  const result = record(value);
  if (!result || !isResourceLink(result.resource) || !("summary" in result)) {
    return undefined;
  }
  const exports = record(result.resources);
  if (result.resources !== undefined && !exports) return undefined;
  const resources: ResourceResult["resources"] = {};
  for (const [name, link] of Object.entries(exports ?? {})) {
    if (isResourceLink(link)) {
      resources[name] = link;
    } else if (Array.isArray(link) && link.every(isResourceLink)) {
      resources[name] = link;
    } else {
      return undefined;
    }
  }
  return { resource: result.resource, summary: result.summary, resources };
}

/** Read the host-declared projection for a call without replacing its raw result. */
export function resourceResultForCall(
  events: readonly Event[],
  toolCallId: string | undefined,
): ResourceResult | undefined {
  if (!toolCallId) return undefined;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event) continue;
    const callId =
      event.type === "message"
        ? event.sender === "agent"
          ? event.tool_call_id
          : undefined
        : event.type === "tool_complete" || event.type === "tool_update"
          ? (event.call_id ?? event.id)
          : undefined;
    if (callId === toolCallId && "model_output" in event) {
      return parseResourceResult(event.model_output);
    }
  }
  return undefined;
}

function isResourceLink(value: unknown): value is ResourceLink {
  const link = record(value);
  return Boolean(
    link &&
    typeof link.uri === "string" &&
    /^aomi:\/\/[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+(?:\/status)?$/.test(
      link.uri,
    ) &&
    typeof link.kind === "string" &&
    link.kind.length > 0 &&
    (link.name === undefined || typeof link.name === "string"),
  );
}
