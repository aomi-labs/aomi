import { UrlLink as Link } from "@/components/url-link";
import { notFound } from "@tanstack/react-router";

import { getSettingsSection, settingsSections } from "./settings-data";
import { SettingsBillingPanel } from "./settings-billing-panel";
import { SettingsGeneralPanel } from "./settings-general-panel";
import { SettingsSecretsPanel } from "./settings-secrets-panel";
import { pageTitle } from "@/components/control-plane/page";

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
          <Icon className="text-aomi-muted size-5" />
          <h1 className={pageTitle}>{section.title}</h1>
        </div>
        <p className="text-aomi-muted max-w-2xl text-sm">{section.description}</p>
      </div>

      {slug === "general" ? (
        <SettingsGeneralPanel />
      ) : slug === "secrets" ? (
        <SettingsSecretsPanel />
      ) : slug === "billing" ? (
        <SettingsBillingPanel />
      ) : (
        <section className="border-border bg-aomi-raised rounded-card border p-4">
          <div className="text-foreground text-sm font-medium">
            {section.status === "soon" ? "Coming soon" : "Current state"}
          </div>
          <p className="text-aomi-muted mt-2 text-[13px]">{section.detail}</p>
          {section.actionHref ? (
            <Link
              href={section.actionHref}
              className="bg-aomi-fg text-aomi-bg hover:bg-aomi-fg/90 mt-4 inline-flex h-8 items-center rounded-control px-3 text-[12px] font-medium transition"
            >
              {section.actionLabel}
            </Link>
          ) : null}
        </section>
      )}
    </div>
  );
}
