import { UrlLink as Link } from "@/components/url-link";

import { settingsStatusLabel, type SettingsSection } from "./settings-data";

export function SettingsCard({ section }: { section: SettingsSection }) {
  const Icon = section.icon;
  const card = (
    <div className="border-border hover:border-border-hover hover:bg-accent-hover h-full rounded-lg border bg-surface-1 p-4 transition">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="size-4 shrink-0 text-dim" />
          <div className="truncate text-sm font-medium text-foreground">
            {section.title}
          </div>
        </div>
        <span className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-dim">
          {settingsStatusLabel(section.status)}
        </span>
      </div>
      <p className="mt-3 text-[13px] text-dim">{section.description}</p>
    </div>
  );

  return (
    <Link href={`/settings/${section.slug}`} className="block h-full">
      {card}
    </Link>
  );
}
