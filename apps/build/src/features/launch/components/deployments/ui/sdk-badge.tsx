import {
  sdkCompatibility,
  type ProjectSdk,
  type SdkCompatibility,
} from "../sdk-compatibility";

type SdkBadgeProps =
  /** A project's shared SDK story: the index row and the project page pass
   *  the same object, so the badge can never read differently between them. */
  | { sdk: ProjectSdk }
  /** A bare stamp, for deployment rows and the backend-requirement badge. */
  | { stamped?: string | null; required?: string | null; label?: string | null };

export function SdkBadge(props: SdkBadgeProps) {
  const compatibility: SdkCompatibility =
    "sdk" in props
      ? props.sdk.compatibility
      : sdkCompatibility(props.stamped, props.required);
  const text =
    "sdk" in props
      ? props.sdk.label
      : (props.label ?? props.stamped ?? "SDK unknown");
  const state =
    compatibility === "current"
      ? "ok"
      : compatibility === "outdated"
        ? "outdated"
        : "missing";
  const tone =
    state === "ok"
      ? "border-positive/40 bg-positive/10 text-positive"
      : state === "outdated"
        ? "border-warning/40 bg-warning/10 text-warning"
        : "border-border bg-surface-2 text-dim";
  return (
    <span
      data-testid="sdk-badge"
      data-state={state}
      className={`inline-flex h-6 items-center rounded-full border px-2 text-[10px] font-medium uppercase tracking-[0.05em] whitespace-nowrap ${tone}`}
    >
      {text}
    </span>
  );
}
