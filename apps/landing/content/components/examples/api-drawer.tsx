"use client";

import {
  useState,
  useCallback,
  useRef,
  type FC,
  type ReactNode,
} from "react";
import { CopyButton } from "@/content/components/playground/CopyButton";

// =============================================================================
// Types
// =============================================================================

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

type ParamField = {
  key: string;
  placeholder: string;
  required?: boolean;
  defaultValue?: string;
};

type HeaderField = {
  key: string;
  placeholder: string;
  required?: boolean;
  defaultValue?: string;
};

type EndpointDef = {
  label: string;
  method: HttpMethod;
  path: string;
  description?: string;
  params?: ParamField[];
  headers?: HeaderField[];
  bodyTemplate?: string;
  /** Override the default base URL for this specific endpoint */
  baseUrl?: string;
};

export type ApiDrawerProps = {
  defaultBaseUrl?: string;
  endpoints: EndpointDef[];
  children?: ReactNode;
};

// =============================================================================
// Method badge
// =============================================================================

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
  POST: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
  PATCH: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  DELETE: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
};

const MethodBadge: FC<{ method: HttpMethod }> = ({ method }) => (
  <span
    className={`inline-flex min-w-[52px] items-center justify-center rounded-md px-2 py-0.5 text-[11px] font-bold tracking-wide ${METHOD_COLORS[method]}`}
  >
    {method}
  </span>
);

// =============================================================================
// Chevron icon
// =============================================================================

const ChevronDown: FC<{ open: boolean }> = ({ open }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`shrink-0 text-fd-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`}
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
);

// =============================================================================
// Single Endpoint Drawer
// =============================================================================

function EndpointDrawer({
  endpoint: ep,
  defaultBaseUrl,
}: {
  endpoint: EndpointDef;
  defaultBaseUrl: string;
}) {
  const [open, setOpen] = useState(false);
  const [baseUrl, setBaseUrl] = useState(ep.baseUrl || defaultBaseUrl);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [headerValues, setHeaderValues] = useState<Record<string, string>>({});
  const [body, setBody] = useState(ep.bodyTemplate ?? "");
  const [response, setResponse] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [statusText, setStatusText] = useState("");
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const resolvedPath = ep.path.replace(/:(\w+)/g, (_, key) => {
    return paramValues[key] || `:${key}`;
  });

  const queryParams = (ep.params ?? []).filter(
    (p) => !ep.path.includes(`:${p.key}`) && (paramValues[p.key] || p.defaultValue),
  );
  const queryString = queryParams.length
    ? "?" +
      queryParams
        .map((p) => {
          const val = paramValues[p.key] || p.defaultValue || "";
          return `${encodeURIComponent(p.key)}=${encodeURIComponent(val)}`;
        })
        .join("&")
    : "";

  const targetUrl = `${baseUrl}${resolvedPath}${queryString}`;
  const proxyUrl = `/api/proxy?url=${encodeURIComponent(targetUrl)}`;

  const send = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setResponse(null);
    setStatus(null);
    setStatusText("");
    setElapsed(null);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    for (const h of ep.headers ?? []) {
      const val = headerValues[h.key] || h.defaultValue;
      if (val) headers[h.key] = val;
    }

    const start = performance.now();

    try {
      const init: RequestInit = {
        method: ep.method,
        headers,
        signal: controller.signal,
      };

      if (ep.method !== "GET" && body.trim()) {
        init.body = body;
      }

      const res = await fetch(proxyUrl, init);
      const ms = Math.round(performance.now() - start);

      setStatus(res.status);
      setStatusText(res.statusText);
      setElapsed(ms);

      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("json")) {
        const json = await res.json();
        setResponse(JSON.stringify(json, null, 2));
      } else {
        const text = await res.text();
        setResponse(text);
      }
    } catch (err: unknown) {
      if ((err as Error).name !== "AbortError") {
        setStatus(0);
        setStatusText("Network Error");
        setResponse(String((err as Error).message ?? err));
        setElapsed(Math.round(performance.now() - start));
      }
    } finally {
      setLoading(false);
    }
  }, [ep, proxyUrl, body, headerValues]);

  return (
    <div className="rounded-2xl border border-fd-border bg-fd-card transition-shadow hover:shadow-sm">
      {/* Collapsed header row */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <MethodBadge method={ep.method} />
        <span className="flex-1 truncate font-mono text-sm text-fd-foreground">
          {ep.path}
        </span>
        <span className="hidden text-xs text-fd-muted-foreground sm:block">
          {ep.label}
        </span>
        <ChevronDown open={open} />
      </button>

      {/* Expanded content */}
      {open && (
        <div className="border-t border-fd-border">
          {/* Description */}
          {ep.description && (
            <p className=" px-5 text-xs leading-relaxed text-fd-muted-foreground">
              {ep.description}
            </p>
          )}

          {/* URL bar */}
          <div className="flex items-center rounded-lg gap-3 border-b border-fd-border px-4 py-3">
            <MethodBadge method={ep.method} />
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="w-36 shrink-0 rounded-lg roundedborder border-fd-border bg-fd-background px-2.5 py-2 text-xs text-fd-foreground"
              placeholder="Base URL"
            />
            <code className="flex-1 px-2 py-1.5 truncate text-xs text-fd-muted-foreground rounded-lg">
              {resolvedPath}
              {queryString}
            </code>
            <button
              type="button"
              onClick={send}
              disabled={loading}
              className="rounded-lg bg-fd-primary px-4 py-2 text-xs font-semibold text-fd-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Sending\u2026" : "Send"}
            </button>
          </div>

          {/* Params + Headers + Body */}
          <div className="grid gap-0 divide-y divide-fd-border md:grid-cols-2 md:divide-x md:divide-y-0">
            {/* Left: params + headers */}
            <div className="space-y-4 px-6 py-4">
              {(ep.params ?? []).length > 0 && (
                <fieldset className="space-y-2">
                  <legend className="text-[10px] font-semibold uppercase tracking-wider text-fd-muted-foreground">
                    Parameters
                  </legend>
                  {ep.params!.map((p) => (
                    <label key={p.key} className="flex items-center gap-3">
                      <span className="w-24 shrink-0  font-mono text-[11px] text-fd-muted-foreground">
                        {p.key}
                        {p.required && (
                          <span className="text-red-500">*</span>
                        )}
                      </span>
                      <input
                        type="text"
                        value={paramValues[p.key] ?? p.defaultValue ?? ""}
                        onChange={(e) =>
                          setParamValues((prev) => ({
                            ...prev,
                            [p.key]: e.target.value,
                          }))
                        }
                        placeholder={p.placeholder}
                        className="flex-1 rounded-lg border border-fd-border bg-fd-background px-2.5 py-1.5 text-xs text-fd-foreground placeholder:text-fd-muted-foreground/50"
                      />
                    </label>
                  ))}
                </fieldset>
              )}

              {(ep.headers ?? []).length > 0 && (
                <fieldset className="space-y-2">
                  <legend className="text-[10px] font-semibold uppercase tracking-wider text-fd-muted-foreground">
                    Headers
                  </legend>
                  {ep.headers!.map((h) => (
                    <label key={h.key} className="flex items-center gap-3">
                      <span className="w-24 shrink-0 text-right font-mono text-[11px] text-fd-muted-foreground">
                        {h.key}
                        {h.required && (
                          <span className="text-red-500">*</span>
                        )}
                      </span>
                      <input
                        type="text"
                        value={headerValues[h.key] ?? h.defaultValue ?? ""}
                        onChange={(e) =>
                          setHeaderValues((prev) => ({
                            ...prev,
                            [h.key]: e.target.value,
                          }))
                        }
                        placeholder={h.placeholder}
                        className="flex-1 rounded-lg border border-fd-border bg-fd-background px-2.5 py-1.5 text-xs text-fd-foreground placeholder:text-fd-muted-foreground/50"
                      />
                    </label>
                  ))}
                </fieldset>
              )}
            </div>

            {/* Right: body editor */}
            <div className="px-6 py-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-fd-muted-foreground">
                  Body
                </span>
                {ep.bodyTemplate && (
                  <button
                    type="button"
                    onClick={() => setBody(ep.bodyTemplate ?? "")}
                    className="text-[10px] text-fd-primary hover:underline"
                  >
                    Reset
                  </button>
                )}
              </div>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={6}
                placeholder={
                  ep.method === "GET"
                    ? "No body for GET requests"
                    : '{ "key": "value" }'
                }
                disabled={ep.method === "GET"}
                className="mt-2 w-full resize-y rounded-lg border border-fd-border bg-fd-background px-3 py-2 font-mono text-xs text-fd-foreground placeholder:text-fd-muted-foreground/50 disabled:opacity-40"
              />
            </div>
          </div>

          {/* Response panel */}
          {(response !== null || loading) && (
            <div className="border-t border-fd-border">
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-fd-muted-foreground">
                    Response
                  </span>
                  {status !== null && (
                    <span
                      className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${
                        status >= 200 && status < 300
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
                          : status >= 400
                            ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
                            : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
                      }`}
                    >
                      {status} {statusText}
                    </span>
                  )}
                  {elapsed !== null && (
                    <span className="text-[11px] text-fd-muted-foreground">
                      {elapsed}ms
                    </span>
                  )}
                </div>
                {response && <CopyButton value={response} label="Copy" />}
              </div>
              {loading ? (
                <div className="flex items-center justify-center py-6">
                  <div className="size-5 animate-spin rounded-full border-2 border-fd-primary border-t-transparent" />
                </div>
              ) : (
                <pre className="max-h-[320px] overflow-auto bg-fd-secondary/30 px-4 py-3 text-xs leading-relaxed text-fd-foreground">
                  <code>{response}</code>
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function ApiDrawer({
  defaultBaseUrl = "https://api.aomi.dev",
  endpoints,
}: ApiDrawerProps) {
  return (
    <div className="space-y-2">
      {endpoints.map((ep, i) => (
        <EndpointDrawer
          key={i}
          endpoint={ep}
          defaultBaseUrl={defaultBaseUrl}
        />
      ))}
    </div>
  );
}

export type { EndpointDef, HttpMethod, ParamField, HeaderField };
