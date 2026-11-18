import { Link } from "@tanstack/react-router";
import { Download, Package, Rocket } from "lucide-react";

type ShipHandoffBannerProps = {
  onDownload?: () => void;
};

/**
 * End-of-run handoff → manage path (Projects), never /deploy/[id].
 */
export function ShipHandoffBanner({ onDownload }: ShipHandoffBannerProps) {
  return (
    <div className="border-aomi-success/30 bg-aomi-success/5 mx-auto my-2 flex max-w-3xl flex-col gap-3 rounded-card border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-foreground text-[13px] font-medium">Ready to ship</p>
        <p className="text-aomi-muted text-[12px]">
          Download your files, or open Projects to manage deploy.
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onDownload}
          className="border-border text-foreground hover:bg-aomi-accent-subtle/40 inline-flex h-8 items-center gap-1.5 rounded-control border px-3 text-[12px] font-medium"
        >
          <Download className="size-3.5" />
          Download code
        </button>
        <Link
          to="/packages"
          className="bg-aomi-fg text-aomi-bg hover:bg-aomi-fg/90 inline-flex h-8 items-center gap-1.5 rounded-control px-3 text-[12px] font-medium transition-colors"
        >
          <Package className="size-3.5" />
          Open Packages
        </Link>
        <span
          className="text-aomi-muted inline-flex h-8 items-center gap-1.5 rounded-control border border-dashed px-3 text-[11px]"
          title="Coming when GitHub create-repo is connected"
        >
          <Rocket className="size-3.5" />
          GitHub init · soon
        </span>
      </div>
    </div>
  );
}
