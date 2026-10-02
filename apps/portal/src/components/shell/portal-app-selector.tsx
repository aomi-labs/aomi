"use client";

import { createElement } from "react";
import { AppWindow, Check, ChevronDown, LockKeyhole } from "lucide-react";
import type { AomiAppDescriptor } from "@aomi-labs/client";
import { useAuthEndpoints } from "@aomi-labs/react";
import {
  getAppIcon,
  HeaderControls,
  resolveAppIdentity,
  Popover,
  PopoverContent,
  PopoverTrigger,
  useSidebar,
} from "@aomi-labs/widget-lib/host-composition";
import type { RequestedAppConfig } from "@portal/lib/portal-client-options";

export interface PortalAppSelectorProps {
  requestedApp: RequestedAppConfig;
  enabledApps: readonly string[];
}

/** Use hosted identity first: two publishers can register the same app name. */
function selectedDescriptor(
  apps: readonly AomiAppDescriptor[],
  requested: RequestedAppConfig,
) {
  return requested.applicationId
    ? apps.find((app) => String(app.applicationId) === requested.applicationId)
    : apps.find((app) => app.name === requested.app);
}

export function appSelectionUrl(
  currentUrl: string,
  app: AomiAppDescriptor | null,
): string {
  const url = new URL(currentUrl);
  for (const key of [
    "aomi_app",
    "app",
    "application_id",
    "applicationId",
    "thread",
  ]) {
    url.searchParams.delete(key);
  }
  if (app) {
    url.searchParams.set("app", app.name);
    if (app.applicationId != null) {
      url.searchParams.set("application_id", String(app.applicationId));
    }
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

function AppIdentity({ app }: { app: string | AomiAppDescriptor }) {
  const info = resolveAppIdentity(app);
  const Icon = getAppIcon(info.brandId) ?? AppWindow;
  return (
    <>
      {createElement(Icon, {
        "aria-hidden": true,
        className: "size-4 shrink-0",
      })}
      <span className="min-w-0 truncate">{info.displayName}</span>
    </>
  );
}

/** URL context persists across new/existing chats, independently of the draft. */
export function PortalAppSelector({
  requestedApp,
  enabledApps,
}: PortalAppSelectorProps) {
  const { state } = useAuthEndpoints();
  if (!requestedApp.app) return null;
  const descriptor = selectedDescriptor(state.appDescriptors, requestedApp);
  const selected = descriptor ?? requestedApp.app ?? "auto";
  const name = resolveAppIdentity(selected).displayName;
  const locked = Boolean(requestedApp.app && requestedApp.locked);
  const controlClass =
    "border-aomi-border text-aomi-fg flex h-8 min-w-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs";

  if (locked) {
    return (
      <div
        data-testid="portal-selected-app"
        aria-label={`Selected app: ${name} (locked)`}
        title={`${name} · This link locks app selection`}
        className={controlClass}
      >
        <AppIdentity app={selected} />
        <LockKeyhole
          aria-hidden="true"
          className="text-aomi-muted ml-auto size-3 shrink-0"
        />
        <span className="text-aomi-muted hidden text-[10px] min-[380px]:inline">
          Locked
        </span>
      </div>
    );
  }

  const choices = state.appDescriptors.filter(
    (app) =>
      app.name !== "orchestrator" &&
      (app.isInstalled === true ||
        (app.applicationId == null &&
          app.isInstalled !== false &&
          enabledApps.includes(app.name))),
  );
  const choose = (app: AomiAppDescriptor | null) => {
    // Re-enter via the existing URL bootstrap: unlocked apps remain composer
    // hints, while the locked URL continues to own Direct routing.
    window.location.assign(appSelectionUrl(window.location.href, app));
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="portal-selected-app"
          aria-label={`Select app: ${name}`}
          title={name}
          className={`${controlClass} hover:bg-aomi-hover focus-visible:outline-aomi-accent w-full`}
        >
          <AppIdentity app={selected} />
          <ChevronDown
            aria-hidden="true"
            className="text-aomi-muted ml-auto size-3 shrink-0"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="border-aomi-border bg-aomi-raised text-aomi-fg w-60 rounded-xl p-1.5"
        aria-label="App selection"
      >
        <p className="text-aomi-muted px-2.5 py-2 text-xs">
          Select an app for a new chat
        </p>
        <div className="max-h-64 overflow-y-auto">
          {[null, ...choices].map((app) => {
            const active = app
              ? Boolean(descriptor === app)
              : !requestedApp.app;
            return (
              <button
                key={app ? `${app.name}:${app.applicationId ?? ""}` : "auto"}
                type="button"
                aria-pressed={active}
                onClick={() => choose(app)}
                className="hover:bg-aomi-hover focus-visible:bg-aomi-hover flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm outline-none"
              >
                <AppIdentity app={app ?? "auto"} />
                {active && (
                  <Check
                    aria-hidden="true"
                    className="ml-auto size-3.5 shrink-0"
                  />
                )}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Keep app context visible when the account sidebar is hidden or collapsed. */
export function PortalHeaderAppSelector(props: PortalAppSelectorProps) {
  const { isMobile, open } = useSidebar();
  if (!props.requestedApp.app) return null;
  return isMobile || !open ? (
    <div className="min-w-0 max-w-36">
      <PortalAppSelector {...props} />
    </div>
  ) : null;
}

/** Make room for the app name on phones while preserving the action buttons. */
export function PortalHeaderControls({
  showAppContext,
  ...props
}: Parameters<typeof HeaderControls>[0] & {
  showAppContext: boolean;
}) {
  const { isMobile } = useSidebar();
  if (!showAppContext) return <HeaderControls {...props} />;
  return (
    <div className="[&>div]:gap-1 md:[&>div]:gap-2.5">
      <HeaderControls {...props} showNetwork={!isMobile} />
    </div>
  );
}
