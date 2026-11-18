import { Settings as SettingsIcon } from "lucide-react";
import { SettingsCard } from "./settings-card";
import { settingsSections } from "./settings-data";
import { pageTitle } from "@/components/control-plane/page";

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <SettingsIcon className="text-dim size-5" aria-hidden />
          <h1 className={pageTitle}>Settings</h1>
        </div>
        <p className="text-dim mt-1.5 max-w-3xl text-sm leading-5">
          Account controls for this GitHub session. Live sections work today;
          others stay listed as Soon.
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {settingsSections.map((section) => (
          <SettingsCard key={section.slug} section={section} />
        ))}
      </section>
    </div>
  );
}
