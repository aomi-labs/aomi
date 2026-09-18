"use client";

import { useProjectDetail } from "@build/features/launch/hooks/use-project-detail";
import { projectSdk } from "../sdk-compatibility";
import { SdkBadge } from "../ui/sdk-badge";
import { EmptyPanel } from "../ui/state-panels";

type Detail = ReturnType<typeof useProjectDetail>;

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-3 px-4 py-3">
      <dt className="text-dim">{label}</dt>
      <dd className="min-w-0 truncate font-medium">{value}</dd>
    </div>
  );
}

export function SettingsTab({ detail }: { detail: Detail }) {
  const source = detail.source;
  if (!source) {
    return <EmptyPanel>Project not found.</EmptyPanel>;
  }
  const required = detail.sdk?.sdkStatus.requiredVersion ?? null;
  const sdk = projectSdk(source, required);

  return (
    <div className="text-sm">
      <dl className="divide-border divide-y">
        <Row label="Repository" value={source.repositoryLink ?? "-"} />
        <Row label="Project ID" value={`#${source.id}`} />
        <Row label="Installation" value={String(source.installationId)} />
      </dl>
      <div className="border-border flex items-center justify-between border-t px-4 py-3">
        <div>
          <div className="font-medium">SDK compatibility</div>
          <div className="text-dim mt-1 text-xs">
            Backend requires {required ?? "unknown"}
            {sdk.warning ? ` · ${sdk.warning}` : ""}
          </div>
        </div>
        <SdkBadge sdk={sdk} />
      </div>
      <div className="border-border border-t px-4 py-4">
        <div className="text-foreground text-sm font-medium">
          Operator access
        </div>
        <p className="text-dim mt-1 text-xs leading-5">
          Claim operator access transfers project writes and its project bots
          from the current operator to you. GitHub will verify that you are a
          repository administrator before the transfer.
        </p>
        <a
          href={`/api/bff/auth/github/claim?projectId=${source.id}`}
          className="border-border text-foreground mt-3 inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium hover:bg-muted"
        >
          Claim operator access
        </a>
      </div>
      <div className="border-border border-t px-4 py-4">
        <div className="text-foreground text-sm font-medium">Danger zone</div>
        <p className="text-dim mt-1 text-xs">
          Disconnect project is coming soon.
        </p>
        <button
          type="button"
          disabled
          title="Coming soon"
          aria-label="Disconnect (coming soon)"
          className="border-border text-dim mt-3 inline-flex h-8 cursor-not-allowed items-center rounded-md border px-3 text-xs font-medium"
        >
          Disconnect · Soon
        </button>
      </div>
    </div>
  );
}
