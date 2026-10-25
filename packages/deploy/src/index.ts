// @aomi-labs/deploy — server-side typed relay for the Aomi platform deploy API.
// (Service-identity/topology lives in @aomi-labs/account/service-topology.)
// The manager client lives in the workspace package @aomi-labs/internal.

export {
  buildActivationRequest,
  buildActivationRequestDiscordBody,
  ACTIVATION_REQUEST_KIND,
  ACTIVATION_REQUEST_SOURCE,
  ACTIVATION_REQUEST_EMBED_COLOR,
} from "./activation-request";

export { builderSecretSlots, missingRequiredSecrets } from "./secrets";

export {
  DeployError,
  BrowserEnvironmentError,
  BackendError,
  ActivationError,
} from "./errors";
export type { DeployErrorCode } from "./errors";

// Every wire type, so @aomi-labs/internal (the manager client) and the apps
// share one definition of the manager's shapes. Response types are inferred
// from the schemas in `@aomi-labs/deploy/schemas`; only their types load here.
export type * from "./types";

export type {
  ActivationRequestInput,
  ActivationRequestPayload,
  DiscordWebhookBody,
} from "./activation-request";

