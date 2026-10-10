import { UrlLink as Link } from "@/components/url-link";
import { notFound } from "@tanstack/react-router";

import { getSettingsSection, settingsSections } from "./settings-data";
import { SettingsBillingPanel } from "./settings-billing-panel";
import { SettingsGeneralPanel } from "./settings-general-panel";
import { SettingsSecretsPanel } from "./settings-secrets-panel";

export default function SettingsSectionPage({
  params,
}: {
  params: { section: string };
}) {
  const { section: slug } = params;
  const section = getSettingsSection(slug);
  if (!section) throw notFound();

  const Icon = section.icon;

  return (
    <div
      className={`flex flex-col ${slug === "general" ? "max-w-4xl gap-10" : "max-w-3xl gap-6"}`}
    >
      <div className={slug === "general" ? "space-y-3" : "space-y-2"}>
        <div className="flex items-center gap-2">
          <Icon className="text-dim size-5" />
          <h1 className="font-display text-foreground text-2xl font-normal tracking-tight">
            {section.title}
          </h1>
        </div>
        <p className="text-subtle max-w-2xl text-sm">{section.description}</p>
      </div>

      {slug === "general" ? (
        <SettingsGeneralPanel />
      ) : slug === "secrets" ? (
        <SettingsSecretsPanel />
      ) : slug === "billing" ? (
        <SettingsBillingPanel />
      ) : (
        <section className="border-border bg-surface-1 rounded-lg border p-4">
          <div className="text-foreground text-sm font-medium">
            {section.status === "soon" ? "Coming soon" : "Current state"}
          </div>
          <p className="text-dim mt-2 text-[13px]">{section.detail}</p>
          {section.actionHref ? (
            <Link
              href={section.actionHref}
              className="bg-primary text-primary-foreground hover:bg-brand-hover mt-4 inline-flex h-8 items-center rounded-md px-3 text-[12px] font-medium transition"
            >
              {section.actionLabel}
            </Link>
          ) : null}
        </section>
      )}
    </div>
  );
}
