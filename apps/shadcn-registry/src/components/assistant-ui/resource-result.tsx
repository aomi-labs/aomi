"use client";

import { useEffect, useRef, useState } from "react";
import {
  AgentApiError,
  parseResourceResult,
  resourceResultForCall,
  type ResourceLink,
  type ResourceRead,
  type AgentResourcesTransport,
} from "@aomi-labs/client";
import { useOptionalAomiRuntime } from "@aomi-labs/react";

/** Resource text is data: it never becomes HTML, a download URL, or an action. */
export function ResourceResultView({
  result,
  toolCallId,
}: {
  result: unknown;
  toolCallId?: string;
}) {
  const runtime = useOptionalAomiRuntime();
  const envelope =
    resourceResultForCall(runtime?.events ?? [], toolCallId) ??
    parseResourceResult(result);
  if (!envelope) return null;
  const links = [
    envelope.resource,
    ...Object.values(envelope.resources).flat(),
  ];
  const unique = [...new Map(links.map((link) => [link.uri, link])).values()];
  return (
    <div className="flex flex-col gap-2">
      <pre className="whitespace-pre-wrap break-words text-xs">
        {typeof envelope.summary === "string"
          ? envelope.summary
          : JSON.stringify(envelope.summary, null, 2)}
      </pre>
      {unique.map((link) => (
        <ResourceLinkView
          key={`${runtime?.resourceScopeKey}:${runtime?.currentThreadId}:${link.uri}`}
          link={link}
          sessionId={runtime?.currentThreadId}
          transport={runtime?.resources}
        />
      ))}
    </div>
  );
}

function ResourceLinkView({
  link,
  sessionId,
  transport,
}: {
  link: ResourceLink;
  sessionId?: string;
  transport?: AgentResourcesTransport;
}) {
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | {
        status: "loaded";
        read: ResourceRead;
        transport: AgentResourcesTransport;
        sessionId: string;
      }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    setState({ status: "idle" });
    return () => {
      pending.current?.abort();
    };
  }, [transport, sessionId]);

  async function inspect(cursor?: string) {
    if (!transport || !sessionId) return;
    pending.current?.abort();
    const request = new AbortController();
    pending.current = request;
    setState({ status: "loading" });
    try {
      const read = await transport.read(sessionId, link.uri, {
        view: "content",
        cursor,
        signal: request.signal,
      });
      if (!request.signal.aborted)
        setState({ status: "loaded", read, transport, sessionId });
    } catch (error) {
      if (!request.signal.aborted)
        setState({
          status: "error",
          message:
            error instanceof AgentApiError && error.code === "resource_gone"
              ? "This resource is no longer available."
              : error instanceof Error
                ? error.message
                : "Unable to read this resource.",
        });
    }
  }

  return (
    <div className="border-aomi-border rounded-md border p-2 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{link.name ?? link.kind}</p>
          <p className="text-aomi-muted break-all">{link.uri}</p>
        </div>
        {transport && sessionId && (
          <button
            type="button"
            disabled={state.status === "loading"}
            onClick={() => void inspect()}
            className="shrink-0 underline disabled:opacity-50"
          >
            {state.status === "loading" ? "Loading…" : "Inspect"}
          </button>
        )}
      </div>
      {state.status === "error" && (
        <p role="alert" className="text-aomi-danger mt-2">
          {state.message}
        </p>
      )}
      {state.status === "loaded" &&
        state.transport === transport &&
        state.sessionId === sessionId && (
          <div className="mt-2">
            <pre className="max-h-[26rem] overflow-auto whitespace-pre-wrap break-words">
              {JSON.stringify(
                state.read.content ?? state.read.summary,
                null,
                2,
              )}
            </pre>
            {!state.read.complete && (
              <p className="text-aomi-muted mt-1">
                Partial content
                {state.read.next_cursor
                  ? "."
                  : " is unavailable beyond this view."}
              </p>
            )}
            {state.read.next_cursor && (
              <button
                type="button"
                className="mt-1 underline"
                onClick={() => void inspect(state.read.next_cursor ?? undefined)}
              >
                Next page
              </button>
            )}
          </div>
        )}
    </div>
  );
}
