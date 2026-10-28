// Pure helpers for a manager-backed BFF or edge surface: error
// identification, release-manifest secret checks, project ownership and the
// browser-safe app status mapping.

export { identifyLaunchError, type LaunchFailureSource } from "./errors";

export {
  fetchReleaseSecretSlots,
  missingSecretsForActivation,
  RequiredSecretsCheckError,
  REQUIRED_SECRETS_CHECK_UNAVAILABLE,
} from "./release-manifest";

export { ownedProject } from "./ownership";

export { launchAppStatusesResult } from "./app-statuses";
