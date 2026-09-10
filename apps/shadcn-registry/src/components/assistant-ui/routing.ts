import type { AgentMode, AgentTarget } from "@aomi-labs/react";

export type DirectRoutingApp =
  | { app: string; applicationId?: never }
  | { applicationId: number; app?: string };

export type AomiRoutingTarget =
  | { mode: "auto" }
  | { mode: "direct"; apps: readonly DirectRoutingApp[] };

/** Host constraints for the widget's execution controls. */
export type AomiRoutingConfig = {
  targets?: readonly AomiRoutingTarget[];
  defaultMode?: AgentMode;
};

export type NormalizedAomiRouting = {
  modes: readonly AgentMode[];
  directApps: readonly DirectRoutingApp[];
  defaultMode: AgentMode;
  error: string | null;
};

const DEFAULT_ROUTING: NormalizedAomiRouting = {
  modes: ["auto"],
  directApps: [],
  defaultMode: "auto",
  error: null,
};

function directAppKey(target: DirectRoutingApp): string {
  return typeof target.applicationId === "number"
    ? `id:${target.applicationId}`
    : `app:${target.app ?? ""}`;
}

export function toAgentTarget(
  target: DirectRoutingApp,
): Extract<AgentTarget, { mode: "direct" }> {
  return { mode: "direct", ...target };
}

export function sameDirectRoutingApp(
  left: DirectRoutingApp,
  right: DirectRoutingApp,
): boolean {
  return directAppKey(left) === directAppKey(right);
}

/**
 * Show a target picker whenever Direct is an interactive choice. A host-fixed
 * Direct-only widget with one app stays chrome-free; every other Direct surface
 * lets the user see and confirm the authoritative destination.
 */
export function shouldShowDirectAppSelect(
  mode: AgentMode,
  routing: NormalizedAomiRouting,
): boolean {
  return (
    mode === "direct" &&
    routing.directApps.length > 0 &&
    (routing.modes.length > 1 || routing.directApps.length > 1)
  );
}

export function normalizeAomiRouting(
  routing?: AomiRoutingConfig,
): NormalizedAomiRouting {
  if (!routing) return DEFAULT_ROUTING;
  const targets = routing.targets ?? [{ mode: "auto" as const }];
  if (targets.length === 0) {
    return {
      ...DEFAULT_ROUTING,
      error: "Routing must allow at least one mode.",
    };
  }

  const hasAuto = targets.some((target) => target.mode === "auto");
  const directTargets = targets.filter(
    (target): target is Extract<AomiRoutingTarget, { mode: "direct" }> =>
      target.mode === "direct",
  );
  const directApps = [
    ...new Map(
      directTargets
        .flatMap((target) => target.apps)
        .map((target) => [directAppKey(target), target]),
    ).values(),
  ];
  const invalidDirectApp = directApps.some(
    (target) =>
      (typeof target.applicationId === "number" &&
        (!Number.isSafeInteger(target.applicationId) ||
          target.applicationId <= 0)) ||
      (typeof target.applicationId !== "number" &&
        (target.app ?? "").trim().length === 0),
  );
  if (invalidDirectApp) {
    return {
      ...DEFAULT_ROUTING,
      error:
        "Direct routing apps need a non-empty app or positive applicationId.",
    };
  }
  if (directTargets.length > 0 && directApps.length === 0) {
    return {
      ...DEFAULT_ROUTING,
      error: "Direct routing must include at least one app.",
    };
  }

  const modes: AgentMode[] = [
    ...(hasAuto ? (["auto"] as const) : []),
    ...(directTargets.length > 0 ? (["direct"] as const) : []),
  ];
  if (modes.length === 0) {
    return { ...DEFAULT_ROUTING, error: "Routing must allow Auto or Direct." };
  }
  const defaultMode = routing.defaultMode ?? (hasAuto ? "auto" : "direct");
  if (!modes.includes(defaultMode)) {
    return {
      modes,
      directApps,
      defaultMode: modes[0]!,
      error: `The default mode ${defaultMode} is not enabled by routing.`,
    };
  }
  return { modes, directApps, defaultMode, error: null };
}
