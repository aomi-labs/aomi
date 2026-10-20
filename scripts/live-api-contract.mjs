// Compose independently served OpenAPI documents. Only the frontend consumer
// needs the union; backend release gates do not call this module.
export function mergeApiDocuments(backend, manager) {
  const paths = structuredClone(backend.paths ?? {});
  for (const [path, methods] of Object.entries(manager.paths ?? {})) {
    const target = (paths[path] ??= {});
    for (const [method, operation] of Object.entries(methods)) {
      const current = target[method];
      if (
        current &&
        JSON.stringify(current["x-aomi-auth"]) !==
          JSON.stringify(operation["x-aomi-auth"])
      ) {
        throw new Error(`Conflicting live API providers: ${method} ${path}`);
      }
      target[method] = operation;
    }
  }
  return { ...backend, paths };
}
export async function fetchApiDocument(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  });
  if (
    !response.ok ||
    !(response.headers.get("content-type") ?? "").includes("application/json")
  ) {
    throw new Error(
      `Target API OpenAPI unavailable: ${new URL(url).pathname} HTTP ${response.status}`,
    );
  }
  const document = await response.json();
  if (!document.paths || typeof document.paths !== "object")
    throw new Error("Target API has no route document");
  return document;
}
