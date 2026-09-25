"use client";

import Link from "next/link";
import { ExternalLink, MessageSquare } from "lucide-react";
import { deploymentLifecycleFromProject } from "@aomi-labs/deploy/lifecycle";
import { useProjectDetail } from "@build/features/launch/hooks/use-project-detail";
import { chatAppUrl } from "@build/lib/chat-url";
import { EmptyPanel } from "../ui/state-panels";
import { projectSdk } from "../sdk-compatibility";

type Detail = ReturnType<typeof useProjectDetail>;

export function ChatTab({ detail }: { detail: Detail }) {
  const source = detail.source;
  if (!source) {
    return <EmptyPanel>Project not found.</EmptyPanel>;
  }

  const lifecycle = deploymentLifecycleFromProject(source);
  const requiredSdk = detail.sdk?.sdkStatus.requiredVersion ?? null;
  if (projectSdk(source, requiredSdk).outdated) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 px-4 py-10 text-center">
        <div>
          <div className="text-base font-semibold">SDK upgrade required</div>
          <div className="text-dim mt-1 max-w-md text-sm leading-6">
            This deployment cannot chat until it is rebuilt with aomi-sdk{" "}
            {requiredSdk}.
          </div>
        </div>
        <Link
          href="?tab=deployments"
          className="bg-warning text-background inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium hover:opacity-90"
        >
          Upgrade deployment
        </Link>
      </div>
    );
  }
  if (lifecycle.kind !== "live" || !lifecycle.chatApp) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 px-4 py-10 text-center">
        <div className="border-border flex size-10 items-center justify-center rounded-full border">
          <MessageSquare className="text-dim size-5" aria-hidden />
        </div>
        <div>
          <div className="text-base font-semibold">No live chat target</div>
          <div className="text-dim mt-1 max-w-md text-sm leading-6">
            Deploy and activate a project app before opening its chat session.
          </div>
        </div>
        <Link
          href="?tab=deployments"
          className="bg-primary text-primary-foreground inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium hover:opacity-90"
        >
          Go to deployments
        </Link>
      </div>
    );
  }

  const url = chatAppUrl(lifecycle.chatApp, {
    locked: true,
    applicationId: lifecycle.chatApplicationId,
  });

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">Chat</div>
          <div className="text-dim mt-1 truncate text-xs">
            {lifecycle.chatApp} · {lifecycle.repo}
          </div>
        </div>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="border-border bg-surface-1 text-foreground hover:bg-accent-hover inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium"
        >
          Open chat
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </div>
      <iframe
        src={url}
        title={`Chat with ${lifecycle.chatApp}`}
        className="border-border bg-surface-1 h-[680px] w-full rounded-md border"
      />
    </div>
  );
}
