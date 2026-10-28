#!/usr/bin/env node
// Deploy the edge Worker. wrangler.jsonc is one configuration for every
// environment; everything that differs per environment comes from the deploy
// environment: product-mono's deploy pipeline reads it from
// infra/cloudflare/edge-environments.json and its Terraform inventory and
// exports it before calling this script, so the same aomi revision deploys
// unchanged to staging, rc and production, and an older Worker build can never
// roll the fleet topology back.
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const TOPOLOGIES = ["staging", "rc", "production"];

// Origins: required, or optional where the environment runs that surface.
const REQUIRED_ORIGINS = ["BACKEND_ORIGINS", "API_SERVER_ORIGIN"];
const OPTIONAL_ORIGINS = ["PAYMENT_ORIGIN", "PORTAL_UPSTREAM_ORIGIN", "BUILD_UPSTREAM_ORIGIN", "MANAGER_ORIGIN"];
// Per-environment settings, passed through when set.
const SETTINGS = [
  "PORTAL_HOSTS",
  "BUILD_HOSTS",
  "CORS_ALLOWED_HOST_PATTERNS",
  "TASK_CORS_PUBLIC_ORIGINS",
  "APP_CATALOG_PLATFORMS",
  "APP_DEPLOY_PLATFORMS",
];

const RC_IDENTITY = ["RC_OIDC_ACCOUNT_ID", "RC_OIDC_SUBJECT", "RC_OIDC_WORKFLOWS"];

function value(name, env) {
  return (env[name] || "").trim();
}

function required(name, env) {
  const result = value(name, env);
  if (!result) throw new Error(`${name} must be set in the deploy environment`);
  return result;
}

function origins(name, raw) {
  for (const origin of raw.split(",").map((part) => part.trim())) {
    const url = new URL(origin);
    if (url.protocol !== "https:") throw new Error(`${name}: ${origin} is not https`);
  }
  return raw;
}

// A route is a host pattern with an optional path pattern, never a scheme.
function routes(raw) {
  const list = raw.split(",").map((part) => part.trim()).filter(Boolean);
  if (list.length === 0) throw new Error("EDGE_ROUTES must name at least one route");
  for (const route of list) {
    if (!/^[a-z0-9*][a-z0-9.*-]*(\/\S*)?$/i.test(route)) throw new Error(`EDGE_ROUTES: ${route} is not a route pattern`);
  }
  return list;
}

export function deployArgs(env = process.env) {
  const topology = required("EDGE_TOPOLOGY", env);
  if (!TOPOLOGIES.includes(topology))
    throw new Error(`EDGE_TOPOLOGY must be one of ${TOPOLOGIES.join(", ")}, not ${topology}`);
  const name = required("EDGE_WORKER_NAME", env);
  const vars = { EDGE_TOPOLOGY: topology };
  for (const key of REQUIRED_ORIGINS) vars[key] = origins(key, required(key, env));
  for (const key of OPTIONAL_ORIGINS) if (value(key, env)) vars[key] = origins(key, value(key, env));
  for (const key of SETTINGS) if (value(key, env)) vars[key] = value(key, env);
  // The RC test identity (api/rc-oidc.ts) is configured for rc alone, all three or none.
  const present = RC_IDENTITY.filter((key) => value(key, env));
  if (present.length && topology !== "rc") throw new Error(`${present[0]} is only valid for the rc topology`);
  if (present.length && present.length !== RC_IDENTITY.length)
    throw new Error(`${RC_IDENTITY.join(", ")} must be set together`);
  for (const key of present) vars[key] = value(key, env);
  return [
    "wrangler",
    "deploy",
    // rc alone binds the replay Durable Object; see wrangler.rc.jsonc.
    ...(topology === "rc" ? ["--config", "wrangler.rc.jsonc"] : []),
    "--name",
    name,
    ...routes(required("EDGE_ROUTES", env)).flatMap((route) => ["--route", route]),
    ...Object.entries(vars).flatMap(([key, entry]) => ["--var", `${key}:${entry}`]),
  ];
}

export function deploy(env = process.env) {
  let args;
  try {
    args = deployArgs(env);
  } catch (error) {
    console.error(error.message);
    return 1;
  }
  const result = spawnSync("pnpm", args, { cwd: ROOT, stdio: "inherit", env });
  return result.status ?? 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(deploy());
}
