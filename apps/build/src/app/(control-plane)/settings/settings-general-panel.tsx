import { Suspense } from "react";

import { PlatformSwitcher } from "@build/components/control-plane/platform-switcher";

export function SettingsGeneralPanel() {
  return (
    <section className="space-y-6">
      <div className="space-y-3">
        <h2 className="font-display text-foreground text-lg font-normal tracking-tight">
          Deployment platform
        </h2>
        <p className="text-subtle max-w-2xl text-sm leading-6">
          Build deploys to one platform at a time. These are the platforms your
          projects are on. If a partner gave you a platform you have not
          connected a project to yet, enter its exact name below.
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
  );
}
