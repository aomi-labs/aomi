import type { UserProject } from "@aomi-labs/deploy";

/**
 * `current`: the live release runs the backend's contract on the backend's
 * SDK. `outdated`: SDK drift — the release still loads (its FFI matches) but
 * was built with another SDK; redeploy to update. `incompatible`: the runtime
 * refuses to load it (FFI missing, unverified, or not the host's); it must be
 * rebuilt. `unknown`: nothing live, or nothing recorded.
 */
export type SdkCompatibility =
  | "current"
  | "outdated"
  | "incompatible"
  | "unknown";

/** Bare SDK equality, for deployment rows that carry only a stamp. */
export function sdkCompatibility(
  stamped?: string | null,
  required?: string | null,
): SdkCompatibility {
  if (!stamped || !required) return "unknown";
  return stamped === required ? "current" : "outdated";
}

/** Oldest SDK whose binaries the runtime verifies against FFI 1 (the legacy
 *  table in `aomi_sdk::legacy_ffi_version`). Rebuild copy names it so an
 *  operator is never told to match one exact SDK number. */
const OLDEST_SUPPORTED_SDK_FOR_FFI_1 = "5.1.1";

/**
 * The one SDK story for a project. The Projects index row and every project
 * page tab (Home, Chat, Settings) render from this, so they can never
 * disagree about which SDK the active application runs on or whether it can
 * run against the backend.
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
  /** SDK drift on a loadable release: redeploy to update, chat still works.
   *  Against a Manager without FFI metadata this is the old SDK-equality
   *  verdict, and there it also blocks chat (that backend refuses mismatched
   *  SDKs outright). */
  outdated: boolean;
  /** The runtime cannot load the live release; it must be rebuilt. */
  incompatible: boolean;
  /** Whether the Chat tab and Chat card must refuse to open a session. */
  chatBlocked: boolean;
  /** How loudly to render `warning`: green/neutral, amber, or red. */
  severity: "info" | "warning" | "error";
  /** What to rebuild an incompatible release with, e.g. "a supported SDK
   *  (5.1.1 or newer)". Never "match the backend's number": any SDK on the
   *  backend's FFI loads, and the backend's own SDK is only one of them.
   *  Null unless `incompatible`. */
  rebuildWith: string | null;
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
  const sdkVerdict: SdkCompatibility = runtimeVersions.some(
    (version) => sdkCompatibility(version, requiredVersion) === "outdated",
  )
    ? "outdated"
    : sdkCompatibility(runtime, requiredVersion);
  const requiredFfi = source.requiredFfiVersion;
  const ffiVersions = [
    ...new Set([
      ...(source.ffiVersions ?? []),
      ...(source.ffiVersion != null ? [source.ffiVersion] : []),
    ]),
  ];
  const foreignFfi = ffiVersions.filter((version) => version !== requiredFfi);
  const unverifiedSdk = source.ffiUnverifiedSdkVersions ?? [];
  const compatibility: SdkCompatibility =
    requiredFfi == null
      ? sdkVerdict
      : source.ffiIncompatible ||
          foreignFfi.length > 0 ||
          unverifiedSdk.length > 0
        ? "incompatible"
        : source.ffiUnrecorded || ffiVersions.length === 0
          ? "unknown"
          : sdkVerdict === "outdated"
            ? "outdated"
            : "current";
  const outdated = compatibility === "outdated";
  const incompatible = compatibility === "incompatible";
  // An FFI-aware backend loads any release on its contract, whatever the SDK;
  // an older backend refuses every SDK but its own.
  const chatBlocked = incompatible || (requiredFfi == null && outdated);
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
  const driftWarning =
    mixed || unrecorded
      ? `Live apps run SDK ${runtimeVersions.join(", ")}${requires}${unrecorded ? "; some runtime SDK records are missing" : ""}; redeploy to update.`
      : `Active application built with SDK ${runtime}${requires}; redeploy to update.`;
  // The oldest SDK verified against FFI 1 is the legacy table's floor; for a
  // later FFI the backend's own SDK is the only floor the UI knows.
  const rebuildWith = incompatible
    ? requiredFfi === 1 || requiredVersion
      ? `a supported SDK (${requiredFfi === 1 ? OLDEST_SUPPORTED_SDK_FOR_FFI_1 : requiredVersion} or newer)`
      : `an SDK on FFI ${requiredFfi}`
    : null;
  const incompatibleReasons = [
    ...(unverifiedSdk.length > 0
      ? [`SDK ${unverifiedSdk.join(", ")} has no verified FFI contract`]
      : []),
    ...(foreignFfi.length > 0
      ? [
          `app FFI ${foreignFfi.join(", ")} does not match backend FFI ${requiredFfi}`,
        ]
      : []),
  ];
  const warning = incompatible
    ? `${
        runtimeVersions.length === 1
          ? `Active application built with SDK ${runtimeVersions[0]}`
          : runtimeVersions.length > 1
            ? `A live app (SDK ${runtimeVersions.join(", ")})`
            : "Active application"
      } cannot run on this backend${
        incompatibleReasons.length > 0
          ? ` (${incompatibleReasons.join("; ")})`
          : ""
      }; rebuild with ${rebuildWith} and redeploy.`
    : requiredFfi != null
      ? compatibility === "unknown" && live
        ? "Runtime FFI compatibility is unrecorded; redeploy to verify it."
        : outdated
          ? driftWarning
          : null
      : outdated
        ? driftWarning
        : unrecorded
          ? `Runtime SDK unrecorded for the active application${
              declared ? ` (repository declares ${declared})` : ""
            }${requires}. Redeploy to record it before trusting this deployment.`
          : null;
  const severity = incompatible ? "error" : warning ? "warning" : "info";
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
    incompatible,
    chatBlocked,
    severity,
    rebuildWith,
    label,
    warning,
  };
}
