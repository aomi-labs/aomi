import { UrlLink as Link } from "@/components/url-link";
import { ArrowRight } from "lucide-react";

/** Secrets belong to a package: they are set on its page, under Secrets. */
export function SettingsSecretsPanel() {
  return (
    <div className="border-border bg-aomi-raised rounded-card border p-4">
      <div className="text-foreground text-sm font-medium">Package secrets</div>
      <p className="text-aomi-muted mt-2 text-[13px]">
        The secrets a package&apos;s tools need are declared in its aomi.toml
        and set on the package page, under Secrets.
      </p>
      <Link
        href="/packages"
        className="bg-aomi-fg text-aomi-bg hover:bg-aomi-fg/90 mt-4 inline-flex h-8 items-center gap-1.5 rounded-control px-3 text-[12px] font-medium transition"
      >
        Open Packages
        <ArrowRight className="size-3.5" aria-hidden />
      </Link>
    </div>
  );
}
