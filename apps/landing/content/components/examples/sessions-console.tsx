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
    label: "List Sessions",
    method: "GET",
    path: "/api/sessions",
    description:
      "Fetch all sessions for a wallet public key. Returns an array of ApiThread objects.",
    params: [
      {
        key: "public_key",
        placeholder: "0x…",
        required: true,
      },
    ],
    headers: [],
  },
  {
    label: "Create Session",
    method: "POST",
    path: "/api/sessions",
    description:
      "Create a new chat session. Returns { session_id, title }.",
    headers: [SESSION_HEADER],
    bodyTemplate: JSON.stringify(
      { public_key: "0x..." },
      null,
      2,
    ),
  },
  {
    label: "Get Session",
    method: "GET",
    path: "/api/sessions/:sessionId",
    description:
      "Fetch a single session by ID. Returns an ApiThread object.",
    params: [
      {
        key: "sessionId",
        placeholder: "session-uuid",
        required: true,
      },
    ],
    headers: [SESSION_HEADER],
  },
  {
    label: "Rename Session",
    method: "PATCH",
    path: "/api/sessions/:sessionId",
    description: "Update the title of a session.",
    params: [
      {
        key: "sessionId",
        placeholder: "session-uuid",
        required: true,
      },
    ],
    headers: [SESSION_HEADER],
    bodyTemplate: JSON.stringify({ title: "New Title" }, null, 2),
  },
  {
    label: "Delete Session",
    method: "DELETE",
    path: "/api/sessions/:sessionId",
    description: "Permanently delete a session.",
    params: [
      {
        key: "sessionId",
        placeholder: "session-uuid",
        required: true,
      },
    ],
    headers: [SESSION_HEADER],
  },
];

export function SessionsConsole() {
  return <ApiConsole endpoints={ENDPOINTS} />;
}
