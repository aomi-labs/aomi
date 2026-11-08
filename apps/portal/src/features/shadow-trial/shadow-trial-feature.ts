// One browser reader for the optional, public staging feature flag.
// appConfig exposes this name through apps/portal/public-env.keys.json.
export const shadowTrialFlag = process.env.NEXT_PUBLIC_SHADOW_TRIAL_ENABLED;
