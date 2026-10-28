#!/usr/bin/env node
// Deploy the edge Worker for one environment. Origins come from the deploy
// environment, not from wrangler.jsonc: product-mono's deploy pipeline derives
// them from its Terraform backend inventory and exports them before calling
// this script, so an older Worker build can never roll the fleet topology back.
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function resolveDeployEnvironment(target) {
  if (target === "staging" || target === "rc" || target === "production") return target;
  throw new Error("Usage: node scripts/deploy.mjs <staging|rc|production>");
}

function requireOrigins(name, env) {
  const value = (env[name] || "").trim();
  if (!value) throw new Error(`${name} must be set in the deploy environment`);
  for (const origin of value.split(",").map((part) => part.trim())) {
    const url = new URL(origin);
    if (url.protocol !== "https:") throw new Error(`${name}: ${origin} is not https`);
  }
  return value;
}

export function deployArgs(environment, env = process.env) {
  const vars = {
    BACKEND_ORIGINS: requireOrigins("BACKEND_ORIGINS", env),
    API_SERVER_ORIGIN: requireOrigins("API_SERVER_ORIGIN", env),
  };
  // Optional surfaces: present only where that environment runs them.
  for (const name of ["PAYMENT_ORIGIN", "PORTAL_UPSTREAM_ORIGIN", "BUILD_UPSTREAM_ORIGIN"]) {
    if ((env[name] || "").trim()) vars[name] = requireOrigins(name, env);
  }
  return [
    "wrangler",
    "deploy",
    "--env",
    environment,
    ...Object.entries(vars).flatMap(([key, value]) => ["--var", `${key}:${value}`]),
  ];
}

export function deploy(target, env = process.env) {
  let args;
  try {
    args = deployArgs(resolveDeployEnvironment(target), env);
  } catch (error) {
    console.error(error.message);
    return 1;
  }
  const result = spawnSync("pnpm", args, { cwd: ROOT, stdio: "inherit", env });
  return result.status ?? 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(deploy(process.argv[2]));
}
