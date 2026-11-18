import { authorize } from "./auth";
import type { BuildContext } from "./context";
import { EdgeError } from "../kernel/errors";

export async function runnerRequest(request: Request, ctx: BuildContext): Promise<Response> {
  const url = new URL(request.url);
  const caller = await authorize(request, ctx, { write: request.method !== "GET" });
  const owner = caller.session.githubUserId;
  if (!owner || caller.key) throw new EdgeError(403, "forbidden");
  const action = url.pathname.slice("/api/build/runs".length);
  let method = request.method;
  let path = "/runs";
  let body;
  if (action === "" && method === "POST") {
    body = request.body;
  } else {
    let id = url.searchParams.get("id");
    if (action === "/cancel" && method === "POST") {
      const input = await request.json().catch(() => null) as { runId?: string } | null;
      id = input?.runId ?? null;
      method = "DELETE";
    } else if (method !== "GET" || !["", "/file", "/download"].includes(action)) {
      return Response.json({ error: "unsupported build operation" }, { status: 405 });
    }
    if (!id || !/^[0-9a-f-]{36}$/.test(id)) throw new EdgeError(400, "invalid_run_id");
    path += "/" + id;
    if (action === "/download") path += "/artifact";
    if (action === "/file") path += "/file?path=" + encodeURIComponent(url.searchParams.get("path") ?? "");
  }
  return ctx.env.BUILD_RUNNER!.fetch(new Request("https://build-runner.internal" + path, {
    method, body, headers: { "x-aomi-build-owner": owner, "content-type": "application/json" },
  }));
}
