// Pure helpers for a manager-backed BFF or edge surface: error
// identification, package-secret errors, project ownership and the
// browser-safe agent status mapping.

export { identifyLaunchError, type LaunchFailureSource } from "./errors";

export {
  RequiredSecretsCheckError,
  REQUIRED_SECRETS_CHECK_UNAVAILABLE,
} from "./required-secrets";

export { ownedProject } from "./ownership";

export { launchAgentStatusesResult } from "./agent-statuses";
