"use client";

import { ApiConsole } from "./api-console";
import type { EndpointDef } from "./api-console";

const SESSION_HEADER = {
  key: "X-Session-Id",
  placeholder: "session-uuid",
  required: true,
};

const AGENT_KEY_HEADER = {
  key: "Aomi-Agent-Key",
  placeholder: "your-agent-key (optional)",
};

const ENDPOINTS: EndpointDef[] = [
  {
    label: "Poll Events",
    method: "GET",
    path: "/v1/agent/chat/{sessionId}",
    description:
      "Fetch the next ordered EventPage using the session path and optional opaque cursor.",
    params: [
      {
        key: "cursor",
        placeholder: "opaque cursor from the previous page",
      },
    ],
    headers: [SESSION_HEADER],
  },
  {
    label: "Start Turn",
    method: "POST",
    path: "/v1/agent/chat",
    description: "Submit StartTurnIntent. Returns the first ordered EventPage.",
    params: [
      { key: "sessionId", placeholder: "session-uuid", required: true },
      { key: "message", placeholder: "Hello!", required: true },
      { key: "agent", placeholder: "aomi/main" },
    ],
    headers: [SESSION_HEADER, AGENT_KEY_HEADER],
  },
  {
    label: "Interrupt",
    method: "POST",
    path: "/v1/agent/chat/{sessionId}/interrupt",
    description: "Submit InterruptIntent and receive the resulting EventPage.",
    headers: [SESSION_HEADER],
  },
  {
    label: "Get Catalog",
    method: "GET",
    path: "/api/thread/catalog",
    description:
      "List toolsets and packages for the signed-in account and thread.",
    params: [{ key: "public_key", placeholder: "0x…" }],
    headers: [SESSION_HEADER, AGENT_KEY_HEADER],
  },
  {
    label: "Get Models",
    method: "GET",
    path: "/api/thread/models",
    description: "List available LLM models.",
    headers: [SESSION_HEADER],
  },
  {
    label: "Set Model",
    method: "POST",
    path: "/api/thread/model",
    description:
      "Set the model for a session. Returns { success, rig, baml, created }.",
    params: [
      { key: "rig", placeholder: "gpt-4o", required: true },
      { key: "toolset", placeholder: "default" },
    ],
    headers: [SESSION_HEADER, AGENT_KEY_HEADER],
  },
];

export function SystemConsole() {
  return <ApiConsole endpoints={ENDPOINTS} />;
}
