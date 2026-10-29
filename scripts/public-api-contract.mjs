import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Service contracts remain separate at runtime; only the SDK combines them.
export function publicApiContract(rustRepo) {
  const documents = [
    ["api-server", process.env.AOMI_AGENT_OPENAPI_FILE],
    ["payment", process.env.AOMI_PAYMENT_OPENAPI_FILE],
  ].map(([service, artifact]) => {
    if (artifact) return JSON.parse(readFileSync(resolve(artifact), "utf8"));
    const result = spawnSync(
      "cargo",
      ["run", "--quiet", "-p", service, "--", "--print-openapi"],
      {
        cwd: rustRepo,
        encoding: "utf8",
        env: { ...process.env, AOMI_PORTAL_URL: "https://chat.aomi.dev" },
      },
    );
    if (result.status !== 0)
      throw new Error(
        `${service} contract export failed: ${result.stderr || result.error}`,
      );
    return JSON.parse(result.stdout);
  });
  const [api, payment] = documents;
  for (const [path, operations] of Object.entries(payment.paths)) {
    if (api.paths[path]) throw new Error(`Duplicate public API path: ${path}`);
    api.paths[path] = operations;
  }
  for (const [kind, entries] of Object.entries(payment.components)) {
    api.components[kind] ??= {};
    for (const [name, schema] of Object.entries(entries)) {
      const prior = api.components[kind][name];
      if (prior && JSON.stringify(prior) !== JSON.stringify(schema)) {
        throw new Error(`Conflicting public API component: ${kind}/${name}`);
      }
      api.components[kind][name] = schema;
    }
  }
  api["x-aomi-route-manifest"] = [
    ...api["x-aomi-route-manifest"],
    ...payment["x-aomi-route-manifest"],
  ].sort();
  return JSON.stringify(api);
}
