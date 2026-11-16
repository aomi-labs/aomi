import { UrlLink as Link } from "@/components/url-link";
import { ArrowRight } from "lucide-react";

/** Secrets belong to a package: they are set on its page, under Secrets. */
export function SettingsSecretsPanel() {
  return (
    <div className="border-border bg-surface-1 rounded-lg border p-4">
      <div className="text-foreground text-sm font-medium">Package secrets</div>
      <p className="text-dim mt-2 text-[13px]">
        The secrets a package&apos;s tools need are declared in its aomi.toml
        and set on the package page, under Secrets.
      </p>
      <Link
        href="/packages"
        className="bg-primary text-primary-foreground hover:bg-brand-hover mt-4 inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12px] font-medium transition"
      >
        Open Packages
        <ArrowRight className="size-3.5" aria-hidden />
      </Link>
    </div>
  );
}
