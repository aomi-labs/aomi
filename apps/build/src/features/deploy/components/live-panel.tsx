"use client";

import { CheckCircle2, ExternalLink } from "lucide-react";
import { TEMPLATE_REPO, TEMPLATE_REPO_URL } from "@build/features/launch";

/** Shared success state. `repo` is owner/name when known; falls back to the
 *  template so the clone story still renders during early wiring.
 *
 *  NOTE: `applicationId` is omitted here because the backend hasn't shipped the
 *  opaque app-identity contract yet. When it does, add the prop and display it. */
export function LivePanel({
  repo,
  chatUrl,
}: {
  repo?: string;
  chatUrl?: string;
}) {
  const repoUrl = repo ? `https://github.com/${repo}` : TEMPLATE_REPO_URL;
  const dir = repo ? repo.split("/")[1] : TEMPLATE_REPO.split("/")[1];
  const chatTitle = repo ? `Chat with ${repo}` : "Chat with your agent";

  return (
    <div className="space-y-4">
      <div className="space-y-4 rounded-3xl border border-green-500/40 bg-green-500/10 p-6">
        <div className="text-foreground flex items-center gap-2 font-medium">
          <CheckCircle2 className="h-5 w-5 text-green-500" />
          {repo ? (
            <span>
              <code>{repo}</code> is live in your chat session.
            </span>
          ) : (
            <span>Your agent is live in your chat session.</span>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-muted-foreground text-sm">
            Make it yours. Clone, edit a tool, and redeploy:
          </p>
          <pre className="bg-background/60 overflow-x-auto rounded-xl p-3 text-xs leading-relaxed">
            {`git clone ${repoUrl}.git
cd ${dir}
$EDITOR src/lib.rs     # copy the GreetTool pattern
aomi-build deploy      # redeploy your changes`}
          </pre>
        </div>

        <div className="flex flex-wrap gap-3 text-sm">
          <a
            href={repoUrl}
            target="_blank"
            rel="noreferrer"
            className="text-foreground inline-flex items-center gap-1 underline"
          >
            Open repo <ExternalLink className="h-3.5 w-3.5" />
          </a>
          {chatUrl && (
            <a
              href={chatUrl}
              target="_blank"
              rel="noreferrer"
              className="text-foreground inline-flex items-center gap-1 underline"
            >
              Open in chat <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </div>

      {chatUrl && (
        <iframe
          src={chatUrl}
          title={chatTitle}
          className="border-input bg-background h-[600px] w-full rounded-xl border"
        />
      )}
    </div>
  );
}
