/**
 * The Build surface at the edge: GitHub sign-in, CLI login, builder credits,
 * the anonymous GitHub App install start and the launch, deployments and
 * operate control-plane families (over the `@aomi-labs/internal` manager
 * client). Anything not listed here passes through to the Vercel Build app
 * unchanged: the build sandbox, integrations and the local-only helpers.
 */
import { passThrough as passThroughTo, proxy, target } from "../kernel/proxy";
import { BACKEND_API_HEADERS } from "../portal/headers";
import type { BuildContext } from "./context";
import { BUILDER_CREDITS_PREFIX, credits } from "./credits";
import { failureResponse } from "./failures";
import { managerOrigin } from "./manager-client";
import * as deploy from "./deploy";
import * as operate from "./operate";
import {
  callback,
  claim,
  cliExchange,
  cliLogin,
  cliStatus,
  login,
  signout,
  status,
} from "./github-auth";

type Handler = (request: Request, ctx: BuildContext) => Response | Promise<Response>;

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type BuildRoute = {
  operation: string;
  method: Method;
  /** An exact path, or a pattern for the few routes with a path parameter. */
  path: string | RegExp;
  handle: Handler;
};

export const GITHUB_APP_INSTALL_START_PATH = "/api/integrations/github-app/oauth/start";

/** Build forwards only the GitHub App install start, anonymously. */
async function installStart(request: Request, ctx: BuildContext): Promise<Response> {
  const url = target(managerOrigin(request, ctx), GITHUB_APP_INSTALL_START_PATH, new URL(request.url).search);
  if (!url.searchParams.get("platform")) url.searchParams.set("platform", ctx.config.platforms[0]);
  return proxy(request, url, { fetchImpl: ctx.fetchImpl, headers: BACKEND_API_HEADERS });
}

export const BUILD_ROUTES: readonly BuildRoute[] = [
  { operation: "github.login", method: "GET", path: "/api/bff/auth/github/login", handle: login },
  { operation: "github.callback", method: "GET", path: "/api/bff/auth/github/callback", handle: callback },
  { operation: "github.claim", method: "GET", path: "/api/bff/auth/github/claim", handle: claim },
  { operation: "github.status", method: "GET", path: "/api/bff/auth/github/status", handle: status },
  { operation: "github.signout", method: "POST", path: "/api/bff/auth/github/signout", handle: signout },
  { operation: "cli.login", method: "GET", path: "/api/bff/cli/login", handle: cliLogin },
  { operation: "cli.exchange", method: "POST", path: "/api/bff/cli/exchange", handle: cliExchange },
  { operation: "cli.status", method: "GET", path: "/api/bff/cli/status", handle: cliStatus },
  { operation: "github_app.install_start", method: "GET", path: GITHUB_APP_INSTALL_START_PATH, handle: installStart },
  ...controlPlane(),
];

/** The launch, deployments and operate families: one row per Vercel route file export. */
function controlPlane(): BuildRoute[] {
  const row = (operation: string, method: Method, path: string | RegExp, handle: Handler): BuildRoute => ({
    operation,
    method,
    path,
    handle,
  });
  const deployments = (name: string) => `/api/bff/deployments/${name}`;
  const launch = (name: string) => `/api/bff/launch/${name}`;
  const ops = (name: string) => `/api/bff/operate/${name}`;
  return [
    // launch
    row("launch.activate", "POST", launch("activate"), deploy.activateRoute),
    row("launch.apps", "GET", launch("apps"), deploy.projectAppsRoute),
    row("launch.attempts", "GET", launch("attempts"), deploy.deploymentAttemptsRoute),
    row("launch.attempts", "POST", launch("attempts"), deploy.deploymentAttemptsRoute),
    row("launch.create_repo", "POST", launch("create"), deploy.createRepoRoute),
    row("launch.deploy", "POST", launch("deploy"), deploy.deployRoute(false)),
    row("launch.preflight", "POST", launch("preflight"), deploy.deployRoute(true)),
    row("launch.projects", "GET", launch("projects"), deploy.userProjectsRoute),
    row("launch.redeploy", "POST", launch("redeploy"), deploy.redeployRoute),
    row("launch.sdk_status", "GET", launch("sdk-status"), deploy.sdkStatusRoute),
    row("launch.status", "GET", launch("status"), deploy.deploymentStatusRoute),
    // deployments
    row("deployment.app_key", "GET", deployments("app-key"), deploy.appKeyRoute),
    row("deployment.app_key", "POST", deployments("app-key"), deploy.appKeyRoute),
    row("deployment.deactivate", "POST", deployments("deactivate"), deploy.deploymentDeactivateRoute),
    row("deployment.deploy", "POST", deployments("deploy"), deploy.deployRoute(false)),
    row("deployment.feed", "GET", deployments("feed"), deploy.deploymentFeedRoute),
    row("deployment.github_app_installations", "GET", deployments("github-app"), deploy.githubAppInstallationsRoute),
    row("deployment.history", "GET", deployments("history"), deploy.deploymentHistoryRoute),
    row("deployment.preflight", "POST", deployments("preflight"), deploy.deployRoute(true)),
    row("deployment.projects", "GET", deployments("projects"), deploy.userProjectsRoute),
    row("deployment.promote", "POST", deployments("promote"), deploy.deploymentPromoteRoute),
    row("deployment.records", "GET", deployments("records"), deploy.deploymentRecordsRoute),
    row("deployment.redeploy", "POST", deployments("redeploy"), deploy.redeployRoute),
    row("deployment.required_secrets", "GET", deployments("required-secrets"), deploy.requiredSecretsRoute),
    row("deployment.sdk_status", "GET", deployments("sdk-status"), deploy.sdkStatusRoute),
    row("deployment.sdk_upgrade", "POST", deployments("sdk-upgrade"), deploy.projectSdkUpgradeRoute),
    row("deployment.sdk_upgrade_status", "GET", deployments("sdk-upgrade-status"), deploy.projectSdkUpgradeStatusRoute),
    row("deployment.secrets_read", "GET", deployments("secrets"), deploy.deploymentSecretsRoute),
    row("deployment.secrets_write", "POST", deployments("secrets"), deploy.deploymentSecretsWriteRoute),
    row("deployment.secrets_delete", "DELETE", deployments("secrets"), deploy.deploymentSecretsDeleteRoute),
    row("deployment.status", "GET", deployments("status"), deploy.deploymentStatusRoute),
    // operate
    row("operate.bots_read", "GET", ops("bots"), operate.operateBotsRoute),
    row("operate.bots_create", "POST", ops("bots"), operate.operateBotsCreateRoute),
    row("operate.bots_delete", "DELETE", ops("bots"), operate.operateBotsDeleteRoute),
    row("operate.bots_update", "PATCH", ops("bots"), operate.operateBotsUpdateRoute),
    row("operate.bots_command_secret", "GET", /^\/api\/bff\/operate\/bots\/[^/]+\/command-secret$/, operate.operateBotsCommandSecretRoute),
    row("operate.bots_webhook", "POST", /^\/api\/bff\/operate\/bots\/[^/]+\/webhook$/, operate.operateBotsWebhookRoute),
    row("operate.logs", "GET", ops("logs"), operate.operateLogsRoute),
    row("operate.model_keys_read", "GET", ops("model-keys"), operate.operateModelKeysRoute),
    row("operate.model_keys_save", "POST", ops("model-keys"), operate.operateModelKeysSaveRoute),
    row("operate.model_keys_grants", "PUT", ops("model-keys"), operate.operateModelKeysGrantsRoute),
    row("operate.model_keys_delete", "DELETE", ops("model-keys"), operate.operateModelKeysDeleteRoute),
    row("operate.observability", "GET", ops("observability"), operate.operateObservabilityRoute),
    row("operate.app_detail", "GET", ops("observability/detail"), operate.operateAppDetailRoute),
    row("operate.payments", "GET", ops("payments"), operate.operatePaymentsRoute),
    row("operate.transactions", "GET", ops("transactions"), operate.operateTransactionsRoute),
    row("operate.usage", "GET", ops("usage"), operate.operateUsageRoute),
  ];
}

function matches(route: BuildRoute, pathname: string): boolean {
  return typeof route.path === "string" ? route.path === pathname : route.path.test(pathname);
}

export function passThrough(request: Request, ctx: BuildContext): Promise<Response> {
  return passThroughTo(request, ctx.upstreamOrigin, ctx.fetchImpl, "build");
}

async function run(operation: string, handle: Handler, request: Request, ctx: BuildContext): Promise<Response> {
  try {
    return await handle(request, ctx);
  } catch (error) {
    return failureResponse(error, request, operation);
  }
}

/** Serve one request on the Build surface. */
export async function handleBuildRequest(request: Request, ctx: BuildContext): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === BUILDER_CREDITS_PREFIX || url.pathname.startsWith(`${BUILDER_CREDITS_PREFIX}/`))
    return run("builder.credits", credits, request, ctx);
  const routes = BUILD_ROUTES.filter((route) => matches(route, url.pathname));
  if (routes.length) {
    const route = routes.find((candidate) => candidate.method === request.method);
    if (!route)
      return new Response(null, {
        status: 405,
        headers: { allow: routes.map((candidate) => candidate.method).join(", ") },
      });
    return run(route.operation, route.handle, request, ctx);
  }
  return passThrough(request, ctx);
}
