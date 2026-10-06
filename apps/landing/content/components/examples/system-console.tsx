"use client";

import { ApiConsole } from "./ApiConsole";
import type { EndpointDef } from "./ApiConsole";

const SESSION_HEADER = {
  key: "X-Session-Id",
  placeholder: "session-uuid",
  required: true,
};

const APP_KEY_HEADER = {
  key: "Aomi-App-Key",
  placeholder: "your-app-key (optional)",
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
    description:
      "Submit StartTurnIntent. Returns the first ordered EventPage.",
    params: [
      { key: "sessionId", placeholder: "session-uuid", required: true },
      { key: "message", placeholder: "Hello!", required: true },
      { key: "app", placeholder: "default" },
    ],
    headers: [SESSION_HEADER, APP_KEY_HEADER],
  },
  {
    label: "Interrupt",
    method: "POST",
    path: "/v1/agent/chat/{sessionId}/interrupt",
    description:
      "Submit InterruptIntent and receive the resulting EventPage.",
    headers: [SESSION_HEADER],
  },
  {
    label: "Get Apps",
    method: "GET",
    path: "/api/session/apps",
    description: "List available apps (agents) for the current context.",
    params: [
      { key: "public_key", placeholder: "0x…" },
    ],
    headers: [SESSION_HEADER, APP_KEY_HEADER],
  },
  {
    label: "Get Models",
    method: "GET",
    path: "/api/session/models",
    description: "List available LLM models.",
    headers: [SESSION_HEADER],
  },
  {
    label: "Set Model",
    method: "POST",
    path: "/api/session/model",
    description:
      "Set the model for a session. Returns { success, rig, baml, created }.",
    params: [
      { key: "rig", placeholder: "gpt-4o", required: true },
      { key: "app", placeholder: "default" },
    ],
    headers: [SESSION_HEADER, APP_KEY_HEADER],
  },
];

export function SystemConsole() {
  return <ApiConsole endpoints={ENDPOINTS} />;
}
