#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const configuredOpenApiUrl = process.env.AOMI_BACKEND_OPENAPI_URL;
const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
const openApiUrl =
  configuredOpenApiUrl ??
  (backendUrl
    ? `${backendUrl.replace(/\/+$/, "")}/api/openapi.json`
    : undefined);

if (!openApiUrl) {
  console.error(
    "Set AOMI_BACKEND_OPENAPI_URL or NEXT_PUBLIC_BACKEND_URL before running the live OpenAPI contract check.",
  );
  process.exit(1);
}

const target = new URL(openApiUrl);
if (!["http:", "https:"].includes(target.protocol))
  throw new Error("The live OpenAPI URL must use HTTP or HTTPS");

const result = spawnSync(
  "pnpm",
  ["exec", "vitest", "run", "--config", "vitest.live-openapi.config.ts"],
  {
    env: {
      ...process.env,
      AOMI_BACKEND_OPENAPI_URL: openApiUrl,
    },
    stdio: "inherit",
  },
);

process.exit(result.status ?? 1);
