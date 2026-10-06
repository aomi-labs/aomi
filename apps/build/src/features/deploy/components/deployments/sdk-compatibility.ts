import type { UserProject } from "@aomi-labs/deploy";

export type SdkCompatibility = "current" | "outdated" | "unknown";

export function sdkCompatibility(
  stamped?: string | null,
  required?: string | null,
): SdkCompatibility {
  if (!stamped || !required) return "unknown";
  return stamped === required ? "current" : "outdated";
}

/**
 * The one SDK story for a project. The Projects index row and every project
 * page tab (Home, Chat, Settings) render from this, so they can never
 * disagree about which SDK the active application runs on or whether it is
 * outdated against the backend requirement.
 */
export type ProjectSdk = {
  /** SDK stamped on the active application's promotion record — what the
   *  live release actually runs. Null when the Manager has no record of it. */
  runtime: string | null;
  /** Every distinct runtime SDK across the project's live apps. */
  runtimeVersions: string[];
  /** SDK the repository declares at its current revision. Only detail reads
   *  carry the configuration, so this is informational — it never decides the
   *  verdict, which would make the index and the page disagree. */
  declared: string | null;
  /** SDK the backend requires; null while the server tags are unknown. */
  required: string | null;
  /** True when at least one app is active with a release — the same rule the
   *  Manager uses to decide which apps carry a runtime SDK. */
  live: boolean;
  /** More than one runtime SDK across live apps. */
  mixed: boolean;
  /** A live app whose runtime SDK the Manager never recorded. Known
   *  mismatches still take precedence over an incomplete record. */
  unrecorded: boolean;
  compatibility: SdkCompatibility;
  outdated: boolean;
  /** Badge text. */
  label: string;
  /** What the operator must know before trusting a Live card; null when the
   *  runtime SDK is recorded and current. */
  warning: string | null;
};

export function projectSdk(
  source: UserProject,
  required?: string | null,
): ProjectSdk {
  // A present summary is authoritative: null can mean only some live apps
  // have SDK records. Historical deployment data cannot fill that gap.
  const hasSummary = source.sdkVersions != null;
  const runtime = hasSummary
    ? (source.sdkVersion ?? null)
    : (source.sdkVersion ??
      source.latestDeployment?.sdkVersion ??
      source.latestDeployment?.apps.find((app) => app.sdkVersion)?.sdkVersion ??
      null);
  const runtimeVersions = [
    ...new Set([...(source.sdkVersions ?? []), ...(runtime ? [runtime] : [])]),
  ];
  const mixed = runtimeVersions.length > 1;
  const live = source.apps.some(
    (app) => app.isActive && app.appReleaseTag != null,
  );
  const declaredVersions = [
    ...new Set(
      source.configuration?.status === "valid"
        ? source.configuration.applications.flatMap((app) =>
            app.sdkVersion ? [app.sdkVersion] : [],
          )
        : [],
    ),
  ];
  const declared = declaredVersions.length === 1 ? declaredVersions[0] : null;
  const requiredVersion = required || null;
  const compatibility: SdkCompatibility = runtimeVersions.some(
    (version) => sdkCompatibility(version, requiredVersion) === "outdated",
  )
    ? "outdated"
    : sdkCompatibility(runtime, requiredVersion);
  const outdated = compatibility === "outdated";
  const unrecorded = live && !mixed && runtime === null;
  const label = mixed
    ? "SDK mixed"
    : unrecorded && runtimeVersions.length > 0
      ? `${runtimeVersions[0]} · runtime incomplete`
      : runtime
        ? runtime
        : unrecorded
          ? declared
            ? `${declared} · runtime unrecorded`
            : "Runtime SDK unrecorded"
          : "SDK unknown";
  const requires = requiredVersion
    ? ` — backend requires ${requiredVersion}`
    : "";
  const warning = outdated
    ? mixed || unrecorded
      ? `Live apps run SDK ${runtimeVersions.join(", ")}${requires}${unrecorded ? "; some runtime SDK records are missing" : ""}; redeploy to update.`
      : `Active application built with SDK ${runtime}${requires}; redeploy to update.`
    : unrecorded
      ? `Runtime SDK unrecorded for the active application${
          declared ? ` (repository declares ${declared})` : ""
        }${requires}. Redeploy to record it before trusting this deployment.`
      : null;
  return {
    runtime,
    runtimeVersions,
    declared,
    required: requiredVersion,
    live,
    mixed,
    unrecorded,
    compatibility,
    outdated,
    label,
    warning,
  };
}
