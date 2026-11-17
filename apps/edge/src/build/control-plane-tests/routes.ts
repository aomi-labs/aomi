// The Build server's route handlers by their old names, served by the edge.
import { route } from "./harness";

/** Serve at the request's own path when it is one of this route's aliases. */
function at(method: string | undefined, ...paths: string[]) {
  return route(
    (url) => (paths.includes(url.pathname) ? url.pathname : paths[0]),
    method,
  );
}
const deployments = (name: string) => `/api/build/deployments/${name}`;
const operate = (name: string) => `/api/build/operate/${name}`;

export const deployRoute = (preflight: boolean) =>
  preflight
    ? at("POST", deployments("preflight"))
    : at("POST", deployments("deploy"));
export const activateRoute = at("POST", deployments("activate"));
export const createRepoRoute = at("POST", deployments("create"));
export const projectAgentsRoute = at("GET", deployments("agents"));
export const userProjectsRoute = at("GET", deployments("projects"));
export const redeployRoute = at("POST", deployments("redeploy"));
export const sdkStatusRoute = at("GET", deployments("sdk-status"));
export const deploymentStatusRoute = at("GET", deployments("status"));
export const deploymentAttemptsRoute = at(undefined, deployments("attempts"));
export const deploymentDeactivateRoute = at("POST", deployments("deactivate"));
export const deploymentFeedRoute = at("GET", deployments("feed"));
export const githubAppInstallationsRoute = at("GET", deployments("github-app"));
export const deploymentHistoryRoute = at("GET", deployments("history"));
export const deploymentPromoteRoute = at("POST", deployments("promote"));
export const deploymentRecordsRoute = at("GET", deployments("records"));
export const requiredSecretsRoute = at("GET", deployments("required-secrets"));
export const projectSdkUpgradeRoute = at("POST", deployments("sdk-upgrade"));
export const projectSdkUpgradeStatusRoute = at(
  "GET",
  deployments("sdk-upgrade-status"),
);
export const deploymentSecretsRoute = at("GET", deployments("secrets"));
export const deploymentSecretsWriteRoute = at("POST", deployments("secrets"));
export const deploymentSecretsDeleteRoute = at(
  "DELETE",
  deployments("secrets"),
);
export const agentKeyRoute = at(undefined, deployments("agent-key"));

export const operateChannelsRoute = at("GET", operate("channels"));
export const operateChannelsCreateRoute = at("POST", operate("channels"));
export const operateChannelsDeleteRoute = at("DELETE", operate("channels"));
export const operateChannelsUpdateRoute = at("PATCH", operate("channels"));
export const operateChannelsCommandSecretRoute = route(
  (url) => url.pathname,
  "GET",
);
export const operateChannelsWebhookRoute = route((url) => url.pathname, "POST");
export const operateLogsRoute = at("GET", operate("logs"));
export const operateObservabilityRoute = at("GET", operate("observability"));
export const operateAgentDetailRoute = at(
  "GET",
  operate("observability/detail"),
);
export const operatePaymentsRoute = at("GET", operate("payments"));
export const operateTransactionsRoute = at("GET", operate("transactions"));
export const operateUsageRoute = at("GET", operate("usage"));
export const operateModelKeysRoute = at("GET", operate("model-keys"));
