import { Link } from "@tanstack/react-router";
import { Download, FolderKanban, Rocket } from "lucide-react";

type ShipHandoffBannerProps = {
  onDownload?: () => void;
};

/**
 * End-of-run handoff → manage path (Projects), never /deploy/[id].
 */
export function ShipHandoffBanner({ onDownload }: ShipHandoffBannerProps) {
  return (
    <div className="border-positive/30 bg-positive/5 mx-auto my-2 flex max-w-3xl flex-col gap-3 rounded-lg border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-foreground text-[13px] font-medium">Ready to ship</p>
        <p className="text-subtle text-[12px]">
          Download your files, or open Projects to manage deploy.
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onDownload}
          className="border-border text-foreground hover:bg-accent/40 inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[12px] font-medium"
        >
          <Download className="size-3.5" />
          Download code
        </button>
        <Link
          to="/projects"
          className="bg-primary text-primary-foreground hover:bg-brand-hover inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12px] font-medium transition-colors"
        >
          <FolderKanban className="size-3.5" />
          Open Projects
        </Link>
        <span
          className="text-dim inline-flex h-8 items-center gap-1.5 rounded-md border border-dashed px-3 text-[11px]"
          title="Coming when GitHub create-repo is connected"
        >
          <Rocket className="size-3.5" />
          GitHub init · soon
        </span>
      </div>
    </div>
  );
}
