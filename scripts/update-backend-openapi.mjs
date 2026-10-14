#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = join(
  repoRoot,
  "packages/client/src/test-fixtures/backend-openapi.json",
);
const routesPath = join(
  repoRoot,
  "packages/client/src/test-fixtures/backend-routes.ts",
);
const managerFixturePath = join(
  repoRoot,
  "packages/client/src/test-fixtures/manager-openapi.json",
);
const backendTmpPath = join(repoRoot, ".tmp/backend-openapi.json");
const managerTmpPath = join(repoRoot, ".tmp/manager-openapi.json");

mkdirSync(dirname(backendTmpPath), { recursive: true });
mkdirSync(dirname(routesPath), { recursive: true });

const openApiUrl = resolveOpenApiUrl();
const backendOpenApi = openApiUrl
  ? await fetchOpenApi(openApiUrl)
  : exportBackendOpenApi(resolveProductMonoRoot());
const managerOpenApi = exportManagerOpenApi(resolveProductMonoRoot());
const openApi = mergeOpenApi(backendOpenApi, managerOpenApi);

writeFileSync(fixturePath, `${JSON.stringify(openApi, null, 2)}\n`);
writeFileSync(managerFixturePath, `${JSON.stringify(managerOpenApi, null, 2)}\n`);
writeFileSync(routesPath, routeSourceFromOpenApi(openApi));
rmSync(backendTmpPath, { force: true });
rmSync(managerTmpPath, { force: true });

console.log(`Updated ${fixturePath}`);
console.log(`Updated ${managerFixturePath}`);
console.log(`Updated ${routesPath}`);

function resolveOpenApiUrl() {
  if (process.env.AOMI_BACKEND_OPENAPI_URL) {
    return process.env.AOMI_BACKEND_OPENAPI_URL;
  }

  if (process.env.NEXT_PUBLIC_BACKEND_URL) {
    return `${process.env.NEXT_PUBLIC_BACKEND_URL.replace(/\/+$/, "")}/api/openapi.json`;
  }

  return undefined;
}

async function fetchOpenApi(openApiUrl) {
  const response = await fetch(openApiUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${openApiUrl}: HTTP ${response.status}`);
  }
  console.log(`Fetched ${openApiUrl}`);
  return response.json();
}

function exportBackendOpenApi(productMonoRoot) {
  const result = spawnSync(
    "cargo",
    [
      "test",
      "-p",
      "backend",
      "endpoint::tests::routes::export_openapi_fixture",
      "--",
      "--ignored",
      "--exact",
      "--nocapture",
    ],
    {
      cwd: join(productMonoRoot, "aomi"),
      env: {
        ...process.env,
        AOMI_OPENAPI_OUT: backendTmpPath,
      },
      stdio: "inherit",
    },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  return JSON.parse(readFileSync(backendTmpPath, "utf8"));
}

function exportManagerOpenApi(productMonoRoot) {
  const result = spawnSync(
    "cargo",
    [
      "test",
      "-p",
      "manager",
      "routes::tests::export_openapi_fixture",
      "--",
      "--ignored",
      "--exact",
      "--nocapture",
    ],
    {
      cwd: join(productMonoRoot, "aomi"),
      env: {
        ...process.env,
        AOMI_MANAGER_OPENAPI_OUT: managerTmpPath,
      },
      stdio: "inherit",
    },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  return JSON.parse(readFileSync(managerTmpPath, "utf8"));
}

function mergeOpenApi(backend, manager) {
  const paths = structuredClone(backend.paths ?? {});
  for (const [path, managerItem] of Object.entries(manager.paths ?? {})) {
    const target = (paths[path] ??= {});
    for (const [method, operation] of Object.entries(managerItem)) {
      const existing = target[method];
      if (
        existing &&
        JSON.stringify(existing["x-aomi-auth"]) !==
          JSON.stringify(operation["x-aomi-auth"])
      ) {
        throw new Error(
          `Conflicting OpenAPI auth contract for ${method} ${path}`,
        );
      }
      target[method] = operation;
    }
  }

  return {
    ...backend,
    info: { ...backend.info, title: "Aomi API" },
    paths,
  };
}

function resolveProductMonoRoot() {
  const configured =
    process.env.AOMI_PRODUCT_MONO_ROOT ?? process.env.PRODUCT_MONO_ROOT;
  const candidates = [
    configured,
    join(repoRoot, "../product-mono"),
    join(repoRoot, "../../product-mono"),
    join(repoRoot, "../../../product-mono"),
    join(repoRoot, "../product-mono.worktrees/main"),
    join(repoRoot, "../../product-mono.worktrees/main"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const root = resolve(candidate);
    if (existsSync(join(root, "aomi/bin/backend/Cargo.toml"))) {
      return root;
    }
  }

  throw new Error(
    "Could not find product-mono. Set AOMI_PRODUCT_MONO_ROOT to the product-mono checkout.",
  );
}

function routeSourceFromOpenApi(openApi) {
  const routes = routeContractFromOpenApi(openApi);
  const body = routes
    .map(
      ({ method, path, auth }) =>
        `  {
    method: ${JSON.stringify(method)},
    path: ${JSON.stringify(path)},
    auth: ${JSON.stringify(auth)},
  },`,
    )
    .join("\n");

  return `// Generated by scripts/update-backend-openapi.mjs. Do not edit by hand.

import type { AomiEndpointSpec } from "./routes";

export const AOMI_BACKEND_ENDPOINTS = [
${body}
] as const satisfies readonly AomiEndpointSpec[];
`;
}

function routeContractFromOpenApi(openApi) {
  const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"];
  const routes = [];

  for (const [path, pathItem] of Object.entries(openApi.paths ?? {})) {
    for (const method of methods) {
      const operation = pathItem?.[method.toLowerCase()];
      if (!operation) {
        continue;
      }

      routes.push({
        method,
        path: clientPath(path),
        auth: operation["x-aomi-auth"],
      });
    }
  }

  return routes.sort((a, b) =>
    `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`),
  );
}

function clientPath(path) {
  return path.replaceAll(/\{([A-Za-z0-9_]+)\}/g, ":$1");
}
