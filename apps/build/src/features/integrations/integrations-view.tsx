"use client";

import { Plug } from "lucide-react";
import { BotsView } from "@/features/operate/bots-view";

export function IntegrationsView() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="space-y-3">
        <p className="text-dim text-[12px] uppercase tracking-wide">Account</p>
        <div className="flex items-center gap-2">
          <Plug className="text-dim size-5" aria-hidden />
          <h1 className="font-display text-foreground text-2xl font-normal tracking-tight">
            Integrations
          </h1>
        </div>
        <p className="text-subtle max-w-2xl text-sm">
          Connect the channels where your users already work. Each bot is
          configured once and can serve one or more Aomi apps.
        </p>
      </div>

      <BotsView />
    </div>
  );
}
