"use client";

import { createElement } from "react";
import { AppWindow } from "lucide-react";
import { useAuthEndpoints } from "@aomi-labs/react";
import type { DirectRoutingApp } from "./routing";
import type { AppTagRequest } from "@/composer/capability-composer/model";
import { resolveAppIdentity } from "./app-metadata";
import { getAppIcon } from "@/icons/app-map";
import { testIds } from "@/test-ids";

/** Informational app context beside the composer's model and safety controls. */
export function AppIndicator({
  app,
}: {
  app?: DirectRoutingApp | AppTagRequest;
}) {
  const { state } = useAuthEndpoints();
  if (!app) return null;
  // Hosted identity takes precedence over a name shared by several publishers.
  const descriptor = state.appDescriptors.find((candidate) =>
    app.applicationId != null
      ? String(candidate.applicationId) === String(app.applicationId)
      : candidate.name === app.app,
  );
  const configuredApp = descriptor ?? app.app;
  if (!configuredApp) return null;
  const identity = resolveAppIdentity(configuredApp);
  const Icon = getAppIcon(identity.brandId) ?? AppWindow;

  return (
    <span
      data-testid={testIds.composerSelectedApp}
      aria-label={`Selected app: ${identity.displayName}`}
      title={identity.displayName}
      className="text-aomi-muted inline-flex h-8 shrink-0 items-center gap-px rounded-full px-2.5 text-xs md:gap-1.5"
    >
      {createElement(Icon, {
        "aria-hidden": true,
        className: "size-3 shrink-0 opacity-60",
      })}
      <span>{identity.displayName}</span>
    </span>
  );
}
