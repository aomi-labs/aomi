const LOCAL_WIDGET_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export class WidgetAuthError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = "WidgetAuthError";
  }
}

export function requireWidgetOrigin(request: Request): string {
  const origin = observedWidgetOrigin(request);
  if (!origin) throw new WidgetAuthError("invalid_widget_origin", 403);
  return origin;
}

export function observedWidgetOrigin(
  request: Request,
  _nodeEnv = process.env.NODE_ENV,
): string | null {
  const rawOrigin = request.headers.get("origin");
  if (!rawOrigin || rawOrigin === "null") return null;
  let origin: URL;
  try {
    origin = new URL(rawOrigin);
  } catch {
    return null;
  }
  if (origin.origin !== rawOrigin) return null;
  if (origin.protocol === "https:") return origin.origin;
  if (origin.protocol === "http:" && LOCAL_WIDGET_HOSTS.has(origin.hostname)) {
    return origin.origin;
  }
  return null;
}

export function widgetOriginDomain(origin: string): string {
  return new URL(origin).host;
}
