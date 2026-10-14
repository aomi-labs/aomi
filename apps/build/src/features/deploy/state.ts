// Launch wizard state — the implementation lives in @aomi-labs/deploy/launch;
// this module keeps the app-local import path (and tests' mock target) stable.
export {
  loadLaunch,
  saveLaunch,
  resetLaunch,
  progressOf,
  withPath,
  withProgress,
  withPendingInstall,
  withRejectedInstall,
  normalizeRepo,
  readGithubRedirect,
  isResumingInstall,
  oneshotStep,
  installationStatusLabel,
  GITHUB_REDIRECT_KEYS,
  ONESHOT_STEPS,
  type LaunchState,
  type PendingInstall,
  type GithubRedirect,
  type OneshotStep,
} from "@aomi-labs/deploy/launch";
