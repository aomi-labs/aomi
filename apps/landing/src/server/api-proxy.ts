import "@tanstack/react-start/server-only";

/**
 * Allowlisted upstream hosts the proxy can forward to.
 * Prevents open-relay abuse.
 */
const ALLOWED_HOSTS = new Set([
  // Polymarket
  "gamma-api.polymarket.com",
  "data-api.polymarket.com",
  "clob.polymarket.com",
  // DefiLlama
  "coins.llama.fi",
  "yields.llama.fi",
  "api.llama.fi",
  "bridges.llama.fi",
  // Aggregators
  "api.0x.org",
  "li.quest",
  "api.cow.fi",
  // X (Twitter)
  "api.x.com",
]);

function isAllowed(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return ALLOWED_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

export async function proxyApiRequest(req: Request): Promise<Response> {
  const targetUrl = new URL(req.url).searchParams.get("url");

  if (!targetUrl) {
    return Response.json({ error: "Missing ?url= parameter" }, { status: 400 });
  }

  if (!isAllowed(targetUrl)) {
    return Response.json({ error: "Host not in allowlist" }, { status: 403 });
  }

  const forwardHeaders = new Headers();
  // Forward headers for generic hosts (skip host/origin/cookie — those are ours).
  const skipHeaders = new Set([
    "host",
    "origin",
    "referer",
    "cookie",
    "connection",
    "content-length",
  ]);
  req.headers.forEach((value, key) => {
    if (!skipHeaders.has(key.toLowerCase())) {
      forwardHeaders.set(key, value);
    }
  });

  let requestBody: string | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    requestBody = await req.text();
    if (requestBody && !forwardHeaders.has("content-type")) {
      forwardHeaders.set("content-type", "application/json");
    }
  }

  try {
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: forwardHeaders,
      body: requestBody,
    });

    const body = await upstream.text();

    return new Response(body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: {
        "Content-Type":
          upstream.headers.get("content-type") ?? "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    return Response.json(
      { error: "Upstream request failed", detail: String(err) },
      { status: 502 },
    );
  }
}
