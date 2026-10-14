"use client";

import Link from "next/link";
import { ArrowRight, Gauge, KeyRound, MessageSquare } from "lucide-react";

import { resolveChatUrl } from "@/lib/chat-url";
import { lastEnvironmentHref, lastUsageHref } from "@/lib/deep-links";

/**
 * Billing guidance: payment setup lives on Chat; spend meter is Usage.
 * Build has no Chat account session, so we do not fetch method status.
 */
export function SettingsBillingPanel() {
  const chatUrl = resolveChatUrl();

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-surface-1 p-4">
        <div className="text-sm font-medium text-foreground">
          Payment setup
        </div>
        <p className="mt-2 text-[13px] leading-5 text-dim">
          Credits, API keys for models, and wallet pay are managed in{" "}
          <span className="text-foreground font-medium">Chat</span>. Build
          signs in with GitHub and cannot show that status here yet.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-surface-1 p-4">
        <div className="text-sm font-medium text-foreground">Coming later</div>
        <p className="mt-2 text-[13px] leading-5 text-dim">
          Balance, invoices, and partner fees. For spend today, use Operate →
          Usage. For app API keys, use Project → Environment.
        </p>
      </div>

      <ul className="divide-border overflow-hidden rounded-lg border border-border bg-surface-1 divide-y">
        <li>
          <Link
            href={lastUsageHref()}
            className="hover:bg-accent-hover flex items-center justify-between gap-3 px-4 py-3 transition"
          >
            <div className="flex min-w-0 items-start gap-3">
              <Gauge className="text-dim mt-0.5 size-4 shrink-0" aria-hidden />
              <div className="min-w-0">
                <div className="text-foreground text-sm font-medium">
                  Operate → Usage
                </div>
                <div className="text-dim mt-0.5 text-xs">
                  Credits and tokens by app
                </div>
              </div>
            </div>
            <ArrowRight className="text-dim size-4 shrink-0" aria-hidden />
          </Link>
        </li>
        <li>
          <Link
            href={lastEnvironmentHref()}
            className="hover:bg-accent-hover flex items-center justify-between gap-3 px-4 py-3 transition"
          >
            <div className="flex min-w-0 items-start gap-3">
              <KeyRound
                className="text-dim mt-0.5 size-4 shrink-0"
                aria-hidden
              />
              <div className="min-w-0">
                <div className="text-foreground text-sm font-medium">
                  Secrets → Environment
                </div>
                <div className="text-dim mt-0.5 text-xs">
                  Builder keys on the project
                </div>
              </div>
            </div>
            <ArrowRight className="text-dim size-4 shrink-0" aria-hidden />
          </Link>
        </li>
        <li>
          <a
            href={chatUrl}
            target="_blank"
            rel="noreferrer"
            className="hover:bg-accent-hover flex items-center justify-between gap-3 px-4 py-3 transition"
          >
            <div className="flex min-w-0 items-start gap-3">
              <MessageSquare
                className="text-dim mt-0.5 size-4 shrink-0"
                aria-hidden
              />
              <div className="min-w-0">
                <div className="text-foreground text-sm font-medium">
                  Open Chat
                </div>
                <div className="text-dim mt-0.5 text-xs">
                  Manage how chat users pay
                </div>
              </div>
            </div>
            <ArrowRight className="text-dim size-4 shrink-0" aria-hidden />
          </a>
        </li>
      </ul>
    </div>
  );
}
