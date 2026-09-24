import { Suspense } from "react";

import { PlatformSwitcher } from "@build/components/control-plane/platform-switcher";

import { SettingsGitHubAppPanel } from "./settings-github-app-panel";

export function SettingsGeneralPanel() {
  return (
    <div className="space-y-10">
      <section className="space-y-6">
        <div className="space-y-3">
          <h2 className="font-display text-foreground text-lg font-normal tracking-tight">
            Deployment platform
          </h2>
          <p className="text-subtle max-w-2xl text-sm leading-6">
            Enter the platform name provided by your partner. Build checks for
            an exact match without exposing a directory of supported platforms.
          </p>
        </div>
        <div className="max-w-2xl">
          <Suspense
            fallback={
              <div
                aria-hidden
                className="border-border h-9 w-full rounded-md border"
              />
            }
          >
            <PlatformSwitcher />
          </Suspense>
        </div>
      </section>
      <SettingsGitHubAppPanel />
    </div>
  );
}
