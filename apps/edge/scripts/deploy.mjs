#!/usr/bin/env node
// Deploy the edge Worker. wrangler.jsonc is one configuration for every
// environment; everything that differs per environment comes from the deploy
// environment: product-mono's deploy pipeline reads it from
// infra/cloudflare/edge-environments.json and its Terraform inventory and
// exports it before calling this script, so the same aomi revision deploys
// unchanged to staging, rc and production, and an older Worker build can never
// roll the fleet topology back.
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const TOPOLOGIES = ["staging", "rc", "production"];

// Origins: required, or optional where the environment runs that surface.
const REQUIRED_ORIGINS = ["BACKEND_ORIGINS", "API_SERVER_ORIGIN"];
const OPTIONAL_ORIGINS = [
  "PAYMENT_ORIGIN",
  "PORTAL_UPSTREAM_ORIGIN",
  "BUILD_UPSTREAM_ORIGIN",
  "LANDING_UPSTREAM_ORIGIN",
  "MANAGER_ORIGIN",
];
// Per-environment settings, passed through when set.
const SETTINGS = [
  "PORTAL_HOSTS",
  "PORTAL_TRUSTED_ORIGINS",
  "BETTER_AUTH_URL",
  "PRIVY_APP_ID",
  "PARA_JWT_AUDIENCE",
  "PARA_JWKS_URL",
  "PARA_API_BASE_URL",
  "AOMI_AUTH_DOMAIN",
  "AOMI_TRUSTED_ORIGINS",
  "BUILD_HOSTS",
  "LANDING_HOSTS",
  "CORS_ALLOWED_HOST_PATTERNS",
  "TASK_CORS_PUBLIC_ORIGINS",
  "APP_CATALOG_PLATFORMS",
  "BUILD_DEFAULT_PLATFORM",
];

const RC_IDENTITY = ["RC_OIDC_ACCOUNT_ID", "RC_OIDC_SUBJECT", "RC_OIDC_WORKFLOWS"];

// The checked-in Hyperdrive binding is the local one. A deploy runs a generated
// copy of the config that binds the environment's Hyperdrive config instead
// (EDGE_HYPERDRIVE_ID), or none where the environment runs no portal. The rc
// config has no binding at all.
const LOCAL_HYPERDRIVE = '"hyperdrive": [{ "binding": "HYPERDRIVE", "id": "local" }],';
const DEPLOY_CONFIG = "wrangler.deploy.jsonc";

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
  // The portal's account surface fails closed without its database and issuer;
  // Landing's own /api routes need its upstream.
  if (vars.PORTAL_HOSTS) for (const key of ["EDGE_HYPERDRIVE_ID", "BETTER_AUTH_URL"]) required(key, env);
  if (vars.LANDING_HOSTS) required("LANDING_UPSTREAM_ORIGIN", env);
  return [
    "wrangler",
    "deploy",
    "--config",
    DEPLOY_CONFIG,
    // The top-level config; `env.dev` is local only.
    "--env",
    "",
    "--name",
    name,
    ...routes(required("EDGE_ROUTES", env)).flatMap((route) => ["--route", route]),
    ...Object.entries(vars).flatMap(([key, entry]) => ["--var", `${key}:${entry}`]),
  ];
}

/** The config a deploy runs: the checked-in one with the environment's Hyperdrive binding, or none. */
export function deployConfig(source, hyperdriveId) {
  if (!source.includes(LOCAL_HYPERDRIVE)) {
    if (hyperdriveId) throw new Error("EDGE_HYPERDRIVE_ID is set, but this Worker config has no Hyperdrive binding");
    return source;
  }
  if (hyperdriveId && !/^[0-9a-f]{32}$/.test(hyperdriveId))
    throw new Error(`EDGE_HYPERDRIVE_ID: ${hyperdriveId} is not a Hyperdrive config id`);
  const binding = hyperdriveId ? LOCAL_HYPERDRIVE.replace('"local"', `"${hyperdriveId}"`) : "";
  return source.replace(LOCAL_HYPERDRIVE, binding);
}

export function deploy(env = process.env) {
  const output = resolve(ROOT, DEPLOY_CONFIG);
  try {
    const args = deployArgs(env);
    // rc alone binds the replay Durable Object; see wrangler.rc.jsonc.
    const source = value("EDGE_TOPOLOGY", env) === "rc" ? "wrangler.rc.jsonc" : "wrangler.jsonc";
    writeFileSync(output, deployConfig(readFileSync(resolve(ROOT, source), "utf8"), value("EDGE_HYPERDRIVE_ID", env)));
    return spawnSync("pnpm", args, { cwd: ROOT, stdio: "inherit", env }).status ?? 1;
  } catch (error) {
    console.error(error.message);
    return 1;
  } finally {
    rmSync(output, { force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(deploy());
}
