"use client";

import Link from "next/link";
import { ExternalLink, MessageSquare } from "lucide-react";
import { deploymentLifecycleFromProject } from "@aomi-labs/deploy/lifecycle";
import { useProjectDetail } from "@/features/deploy/hooks/use-project-detail";
import { chatAppUrl } from "@/lib/chat-url";
import { AppKeyPanel } from "../app-key-panel";
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
  const sdk = projectSdk(source, requiredSdk);
  // SDK drift on a loadable release is not a gate: the runtime serves it.
  // Only a release it refuses to load (or any mismatch against an older,
  // FFI-unaware backend) closes the tab.
  if (sdk.chatBlocked) {
    return (
      <div
        data-testid="chat-gate"
        data-severity={sdk.severity}
        className="flex min-h-[320px] flex-col items-center justify-center gap-4 px-4 py-10 text-center"
      >
        <div>
          <div
            className={`text-base font-semibold ${sdk.incompatible ? "text-destructive" : ""}`}
          >
            {sdk.incompatible
              ? "App cannot run on this backend"
              : "SDK upgrade required"}
          </div>
          <div className="text-dim mt-1 max-w-md text-sm leading-6">
            {sdk.incompatible
              ? `This deployment cannot chat: its build has no FFI contract this backend can load. Rebuild it with ${sdk.rebuildWith} and redeploy.`
              : `This deployment cannot chat until it is rebuilt with aomi-sdk ${requiredSdk}.`}
          </div>
        </div>
        <Link
          href="?tab=deployments"
          className={`text-background inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium hover:opacity-90 ${
            sdk.incompatible ? "bg-destructive" : "bg-warning"
          }`}
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
  // A private app answers only requests carrying its key; its builder manages
  // and shares that key here.
  const chatApplication = source.apps.find(
    (app) => app.id === lifecycle.chatApplicationId,
  );
  const privateApplication =
    chatApplication && !chatApplication.isPublic ? chatApplication : null;

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
      {privateApplication && (
        <AppKeyPanel
          applicationId={privateApplication.id}
          appName={privateApplication.name}
        />
      )}
      <iframe
        src={url}
        title={`Chat with ${lifecycle.chatApp}`}
        className="border-border bg-surface-1 h-[680px] w-full rounded-md border"
      />
    </div>
  );
}
