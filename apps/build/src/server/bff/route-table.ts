import "@tanstack/react-start/server-only";

/** One HTTP method's handler. Each lazily imports its server module, so a
 *  handler's code is loaded on first use and stays out of the route tree. */
type Handler = (request: Request) => Response | Promise<Response>;
type Methods = Partial<Record<string, Handler>>;

function lazy<K extends string, M extends Record<K, Handler>>(
  load: () => Promise<M>,
  name: K,
): Handler {
  return async (request) => (await load())[name](request);
}

const githubAuth = () => import("@/server/http/github-auth");
const cliAuth = () => import("@/server/http/cli-auth");
const sentrySmoke = () => import("@/server/http/sentry-smoke");
const buildSupervisor = () => import("@/server/http/build-supervisor");
const build = () => import("@/server/bff/build/routes");
const integrations = () => import("@/server/bff/integrations/routes");
const attempts = () => import("@/server/bff/deploy/attempts");
const githubApp = () => import("@/server/bff/deploy/github-app");
const sdkUpgrade = () => import("@/server/bff/deploy/project-upgrade");
const deploy = () => import("@/server/bff/deploy/deploy");
const deployHistory = () => import("@/server/bff/deploy/history");
const deployProjects = () => import("@/server/bff/deploy/projects");
const deployPromote = () => import("@/server/bff/deploy/promote");
const deploySdk = () => import("@/server/bff/deploy/sdk");
const deploySecrets = () => import("@/server/bff/deploy/secrets");
const bots = () => import("@/server/bff/operate/bots");
const logs = () => import("@/server/bff/operate/logs");
const modelKeys = () => import("@/server/bff/operate/model-keys");
const observability = () => import("@/server/bff/operate/observability");
const payments = () => import("@/server/bff/operate/payments");
const transactions = () => import("@/server/bff/operate/transactions");
const usage = () => import("@/server/bff/operate/usage");

const runDeploy: Handler = async (request) =>
  (await deploy()).deployRoute(false)(request);
const preflightDeploy: Handler = async (request) =>
  (await deploy()).deployRoute(true)(request);

/** Every `/api/bff/*` endpoint: path below `/api/bff/` → its methods. A `$name`
 *  segment matches any one non-empty path segment. */
export const bffRoutes: Record<string, Methods> = {
  "auth/github/callback": { GET: lazy(githubAuth, "githubCallbackRoute") },
  "auth/github/claim": { GET: lazy(githubAuth, "githubClaimRoute") },
  "auth/github/dev-session": { GET: lazy(githubAuth, "githubDevSessionRoute") },
  "auth/github/login": { GET: lazy(githubAuth, "githubLoginRoute") },
  "auth/github/signout": { POST: lazy(githubAuth, "githubSignoutRoute") },
  "auth/github/status": { GET: lazy(githubAuth, "githubSessionRoute") },

  "build/runs": {
    POST: lazy(build, "createBuildRunRoute"),
    GET: lazy(build, "buildRunStatusRoute"),
  },
  "build/runs/cancel": { POST: lazy(build, "buildRunCancelRoute") },
  "build/runs/decision": { POST: lazy(build, "buildRunDecisionRoute") },
  "build/runs/download": { GET: lazy(build, "buildRunDownloadRoute") },
  "build/runs/file": { GET: lazy(build, "buildRunFileRoute") },
  "build/supervise": { GET: lazy(buildSupervisor, "GET") },

  "cli/exchange": { POST: lazy(cliAuth, "cliExchangeRoute") },
  "cli/login": { GET: lazy(cliAuth, "cliLoginRoute") },
  "cli/status": { GET: lazy(cliAuth, "cliStatusRoute") },

  "deployments/deactivate": {
    POST: lazy(deployPromote, "deploymentDeactivateRoute"),
  },
  "deployments/deploy": { POST: runDeploy },
  "deployments/feed": { GET: lazy(deployHistory, "deploymentFeedRoute") },
  "deployments/github-app": {
    GET: lazy(githubApp, "githubAppInstallationsRoute"),
  },
  "deployments/history": { GET: lazy(deployHistory, "deploymentHistoryRoute") },
  "deployments/preflight": { POST: preflightDeploy },
  "deployments/projects": { GET: lazy(deployProjects, "userProjectsRoute") },
  "deployments/promote": {
    POST: lazy(deployPromote, "deploymentPromoteRoute"),
  },
  "deployments/records": { GET: lazy(deployHistory, "deploymentRecordsRoute") },
  "deployments/redeploy": { POST: lazy(deploy, "redeployRoute") },
  "deployments/required-secrets": {
    GET: lazy(deploySecrets, "requiredSecretsRoute"),
  },
  "deployments/sdk-status": { GET: lazy(deploySdk, "sdkStatusRoute") },
  "deployments/sdk-upgrade": {
    POST: lazy(sdkUpgrade, "projectSdkUpgradeRoute"),
  },
  "deployments/sdk-upgrade-status": {
    GET: lazy(sdkUpgrade, "projectSdkUpgradeStatusRoute"),
  },
  "deployments/secrets": {
    GET: lazy(deploySecrets, "deploymentSecretsRoute"),
    POST: lazy(deploySecrets, "deploymentSecretsWriteRoute"),
    DELETE: lazy(deploySecrets, "deploymentSecretsDeleteRoute"),
  },
  "deployments/status": { GET: lazy(deploy, "deploymentStatusRoute") },

  integrations: {
    GET: lazy(integrations, "integrationsStatusRoute"),
    POST: lazy(integrations, "integrationsConnectRoute"),
  },
  "internal/sentry-smoke": {
    POST: lazy(sentrySmoke, "POST"),
    GET: lazy(sentrySmoke, "GET"),
    PUT: lazy(sentrySmoke, "PUT"),
    PATCH: lazy(sentrySmoke, "PATCH"),
    DELETE: lazy(sentrySmoke, "DELETE"),
    OPTIONS: lazy(sentrySmoke, "OPTIONS"),
  },

  "launch/activate": { POST: lazy(deployPromote, "activateRoute") },
  "launch/apps": { GET: lazy(deployProjects, "projectAppsRoute") },
  "launch/attempts": {
    GET: lazy(attempts, "deploymentAttemptsRoute"),
    POST: lazy(attempts, "deploymentAttemptsRoute"),
  },
  "launch/create": { POST: lazy(deployProjects, "createRepoRoute") },
  "launch/deploy": { POST: runDeploy },
  "launch/preflight": { POST: preflightDeploy },
  "launch/projects": { GET: lazy(deployProjects, "userProjectsRoute") },
  "launch/redeploy": { POST: lazy(deploy, "redeployRoute") },
  "launch/sdk-status": { GET: lazy(deploySdk, "sdkStatusRoute") },
  "launch/status": { GET: lazy(deploy, "deploymentStatusRoute") },

  "operate/bots": {
    GET: lazy(bots, "operateBotsRoute"),
    POST: lazy(bots, "operateBotsCreateRoute"),
    DELETE: lazy(bots, "operateBotsDeleteRoute"),
    PATCH: lazy(bots, "operateBotsUpdateRoute"),
  },
  "operate/bots/$botId/command-secret": {
    GET: lazy(bots, "operateBotsCommandSecretRoute"),
  },
  "operate/bots/$botId/webhook": {
    POST: lazy(bots, "operateBotsWebhookRoute"),
  },
  "operate/logs": { GET: lazy(logs, "operateLogsRoute") },
  "operate/model-keys": {
    GET: lazy(modelKeys, "operateModelKeysRoute"),
    POST: lazy(modelKeys, "operateModelKeysSaveRoute"),
    PUT: lazy(modelKeys, "operateModelKeysGrantsRoute"),
    DELETE: lazy(modelKeys, "operateModelKeysDeleteRoute"),
  },
  "operate/observability": {
    GET: lazy(observability, "operateObservabilityRoute"),
  },
  "operate/observability/detail": {
    GET: lazy(observability, "operateAppDetailRoute"),
  },
  "operate/payments": { GET: lazy(payments, "operatePaymentsRoute") },
  "operate/transactions": {
    GET: lazy(transactions, "operateTransactionsRoute"),
  },
  "operate/usage": { GET: lazy(usage, "operateUsageRoute") },
};

const BFF_PREFIX = "/api/bff/";

/** The methods for a router-normalized pathname, matched like the router
 *  would: case-sensitive static segments, `$param` = one non-empty segment. */
export function matchBffRoute(pathname: string): Methods | undefined {
  if (!pathname.startsWith(BFF_PREFIX)) return undefined;
  const path = pathname.slice(BFF_PREFIX.length);
  if (Object.hasOwn(bffRoutes, path)) return bffRoutes[path];
  const parts = path.split("/");
  for (const [pattern, methods] of Object.entries(bffRoutes)) {
    const segments = pattern.split("/");
    if (
      segments.length === parts.length &&
      segments.every((segment, index) =>
        segment.startsWith("$")
          ? parts[index] !== ""
          : segment === parts[index],
      )
    )
      return methods;
  }
  return undefined;
}

// Same order and semantics as `installNativeHttpMethods` + TanStack Start's
// method dispatch, which the per-path route files used to get for free.
const HTTP_METHODS = [
  "GET",
  "HEAD",
  "OPTIONS",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
];

function allowHeader(methods: Methods): string {
  const implemented = HTTP_METHODS.filter((method) => methods[method]);
  if (methods.GET && !methods.HEAD) implemented.push("HEAD");
  return ["OPTIONS", ...implemented].sort().join(", ");
}

/** Dispatch one request to its declared methods: HEAD falls back to GET, an
 *  undeclared OPTIONS answers 204 + `Allow`, anything else is 405 (400 for a
 *  non-standard method). */
export function serveMethods(
  methods: Methods,
  request: Request,
): Response | Promise<Response> {
  const method = request.method.toUpperCase();
  const own = (name: string) =>
    Object.hasOwn(methods, name) ? methods[name] : undefined;
  const handler = method === "HEAD" ? (own("HEAD") ?? own("GET")) : own(method);
  if (handler) return handler(request);
  if (method === "OPTIONS")
    return new Response(null, {
      status: 204,
      headers: { Allow: allowHeader(methods) },
    });
  return new Response(null, {
    status: HTTP_METHODS.includes(request.method) ? 405 : 400,
  });
}

/** Unknown `/api/bff/*` paths keep falling through to the `/api/$` proxy. */
function backendProxy(slug: string[]): Methods {
  const proxy =
    (name: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"): Handler =>
    async (request) =>
      (await import("@/server/http/backend-proxy"))[name](request, {
        params: Promise.resolve({ slug }),
      });
  return {
    GET: proxy("GET"),
    POST: proxy("POST"),
    PUT: proxy("PUT"),
    PATCH: proxy("PATCH"),
    DELETE: proxy("DELETE"),
  };
}

export function serveBff(
  request: Request,
  pathname: string,
  splat: string | undefined,
): Response | Promise<Response> {
  const methods =
    matchBffRoute(pathname) ??
    backendProxy(["bff", ...(splat?.split("/").filter(Boolean) ?? [])]);
  return serveMethods(methods, request);
}
