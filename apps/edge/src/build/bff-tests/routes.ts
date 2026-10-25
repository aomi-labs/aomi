// The Build BFF's route handlers by their old names, served by the edge.
import { route } from "./harness";

/** Serve at the request's own path when it is one of this route's aliases. */
function at(method: string | undefined, ...paths: string[]) {
  return route((url) => (paths.includes(url.pathname) ? url.pathname : paths[0]), method);
}
const launch = (name: string) => `/api/bff/launch/${name}`;
const deployments = (name: string) => `/api/bff/deployments/${name}`;
const operate = (name: string) => `/api/bff/operate/${name}`;

export const deployRoute = (preflight: boolean) =>
  preflight
    ? at("POST", launch("preflight"), deployments("preflight"))
    : at("POST", launch("deploy"), deployments("deploy"));
export const activateRoute = at("POST", launch("activate"));
export const createRepoRoute = at("POST", launch("create"));
export const projectAppsRoute = at("GET", launch("apps"));
export const userProjectsRoute = at("GET", launch("projects"), deployments("projects"));
export const redeployRoute = at("POST", launch("redeploy"), deployments("redeploy"));
export const sdkStatusRoute = at("GET", launch("sdk-status"), deployments("sdk-status"));
export const deploymentStatusRoute = at("GET", launch("status"), deployments("status"));
export const deploymentAttemptsRoute = at(undefined, launch("attempts"));
export const deploymentDeactivateRoute = at("POST", deployments("deactivate"));
export const deploymentFeedRoute = at("GET", deployments("feed"));
export const githubAppInstallationsRoute = at("GET", deployments("github-app"));
export const deploymentHistoryRoute = at("GET", deployments("history"));
export const deploymentPromoteRoute = at("POST", deployments("promote"));
export const deploymentRecordsRoute = at("GET", deployments("records"));
export const requiredSecretsRoute = at("GET", deployments("required-secrets"));
export const projectSdkUpgradeRoute = at("POST", deployments("sdk-upgrade"));
export const projectSdkUpgradeStatusRoute = at("GET", deployments("sdk-upgrade-status"));
export const deploymentSecretsRoute = at("GET", deployments("secrets"));
export const deploymentSecretsWriteRoute = at("POST", deployments("secrets"));
export const deploymentSecretsDeleteRoute = at("DELETE", deployments("secrets"));
export const appKeyRoute = at(undefined, deployments("app-key"));

export const operateBotsRoute = at("GET", operate("bots"));
export const operateBotsCreateRoute = at("POST", operate("bots"));
export const operateBotsDeleteRoute = at("DELETE", operate("bots"));
export const operateBotsUpdateRoute = at("PATCH", operate("bots"));
export const operateBotsCommandSecretRoute = route((url) => url.pathname, "GET");
export const operateBotsWebhookRoute = route((url) => url.pathname, "POST");
export const operateLogsRoute = at("GET", operate("logs"));
export const operateObservabilityRoute = at("GET", operate("observability"));
export const operateAppDetailRoute = at("GET", operate("observability/detail"));
export const operatePaymentsRoute = at("GET", operate("payments"));
export const operateTransactionsRoute = at("GET", operate("transactions"));
export const operateUsageRoute = at("GET", operate("usage"));
export const operateModelKeysRoute = at("GET", operate("model-keys"));

export { clearDeployReadCache } from "../deploy";
export { clearOperateCachesForTesting } from "../operate";
