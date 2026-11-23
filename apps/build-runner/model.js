// Called only by the per-container egress interceptor. Keep provider credentials in the Worker.
export async function modelRequest(request, env, run, send = fetch) {
  const path = new URL(request.url).pathname;
  const claude = run?.input.builder === "claude" && ["/v1/messages", "/v1/messages/count_tokens"].includes(path);
  const codex = run?.input.builder === "codex" && path === "/v1/responses";
  if (!run || run.status !== "running" || Date.now() >= run.expires || request.method !== "POST" ||
      (!claude && !codex) || request.headers.get("authorization") !== "Bearer " + run.modelCapability) {
    return new Response(null, { status: 403 });
  }
  const token = claude ? env.OPENROUTER_API_KEY : env.OPENAI_API_KEY;
  if (!token) return new Response("Model provider unavailable", { status: 503 });
  const headers = new Headers({ authorization: "Bearer " + token, "content-type": "application/json" });
  if (claude) headers.set("anthropic-version", "2023-06-01");
  const origin = claude ? "https://openrouter.ai/api" : "https://api.openai.com";
  // Workers subrequests accept only follow or manual. Never follow an inference redirect with credentials.
  const response = await send(origin + path, { method: "POST", body: request.body, headers, redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    return new Response("Model provider redirect refused", { status: 502 });
  }
  return response;
}
