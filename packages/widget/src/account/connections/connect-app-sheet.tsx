"use client";

import { useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import type { AomiConnectionKind } from "@aomi-labs/client";
import { aomiButton } from "@/ui/aomi/button";
import { AomiSheet } from "@/ui/aomi/aomi-sheet";
import { ListGroup } from "@/ui/aomi/list-group";
import { SectionHeader } from "@/ui/aomi/section-header";
import {
  ChoiceRow,
  FootnoteLink,
  SheetFootnote,
  SheetHeader,
} from "@/wallet/picker/sheet-parts";
import { CopyButton } from "@/account/account-management/controls";
import { ConnectionMark } from "./connection-mark";

type App = {
  name: string;
  kind: AomiConnectionKind;
  description?: string;
};

const AI_CLIENTS: App[] = [
  { name: "Claude", kind: "ai" },
  { name: "Codex", kind: "ai" },
  { name: "Cursor", kind: "ai" },
];
const MORE: App[] = [
  { name: "Telegram", kind: "telegram", description: "Any Aomi bot" },
  { name: "Terminal", kind: "cli", description: "Aomi CLI" },
  { name: "Your own app", kind: "app", description: "SDK" },
];

const MCP_GUIDE = "https://aomi.dev/docs/guides/mcp";
const SDK_GUIDE = "https://aomi.dev/docs/reference/sdk";

/** A value to paste somewhere else, with its copy button. */
function CopyRow({ value }: { value: string }) {
  return (
    <div className="rounded-control bg-aomi-surface-2 type-address flex w-full items-center gap-2 py-1 pl-2.5 pr-1">
      <span className="min-w-0 flex-1 truncate" title={value}>
        {value}
      </span>
      <CopyButton value={value} label={`Copy ${value}`} />
    </div>
  );
}

function GuideLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`${aomiButton({ variant: "secondary" })} h-10 w-full`}
    >
      {children}
      <ExternalLink />
    </a>
  );
}

/**
 * Settings › Connections › Add: the wallet popup's choose step with apps
 * instead of wallets, then one screen per app in the same sheet.
 */
export function ConnectAppSheet({ onClose }: { onClose: () => void }) {
  const [app, setApp] = useState<App | null>(null);
  const back = (
    <FootnoteLink onClick={() => setApp(null)}>Choose another app</FootnoteLink>
  );
  const row = (choice: App) => (
    <ChoiceRow
      key={choice.name}
      leading={<ConnectionMark kind={choice.kind} name={choice.name} />}
      title={choice.name}
      description={choice.description}
      onClick={() => setApp(choice)}
    />
  );

  if (!app)
    return (
      <AomiSheet onClose={onClose}>
        <SheetHeader
          title="Connect an app"
          description="Use your account and agent wallet from somewhere else."
          onClose={onClose}
        />
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-5">
          <section className="flex flex-col gap-2">
            <SectionHeader title="AI clients" detail="Over MCP" />
            <ListGroup>{AI_CLIENTS.map(row)}</ListGroup>
          </section>
          <section className="flex flex-col gap-2">
            <SectionHeader title="More" />
            <ListGroup>{MORE.map(row)}</ListGroup>
          </section>
          <SheetFootnote>New connections ask before every trade.</SheetFootnote>
        </div>
      </AomiSheet>
    );

  const screen =
    app.kind === "ai"
      ? {
          title: `Connect ${app.name}`,
          description: `Add Aomi as an MCP server in ${app.name}.`,
          body: (
            <>
              <CopyRow
                value={new URL("/v1/agent/mcp", window.location.origin).href}
              />
              <GuideLink href={MCP_GUIDE}>Open the setup guide</GuideLink>
            </>
          ),
          footnote: (
            <>
              {app.name} opens Aomi to sign in. · {back}
            </>
          ),
        }
      : app.kind === "cli"
        ? {
            title: "Connect a terminal",
            description: "Install the CLI, then sign in.",
            body: (
              <>
                <CopyRow value="npm i -g @aomi-labs/cli" />
                <CopyRow value="aomi account login" />
              </>
            ),
            footnote: <>It opens this site to confirm a code. · {back}</>,
          }
        : app.kind === "telegram"
          ? {
              title: "Connect Telegram",
              description: "Send /link to any Aomi bot.",
              body: (
                <p className="type-control text-center">
                  The bot sends you a button back here to confirm.
                </p>
              ),
              footnote: back,
            }
          : {
              title: "Connect your own app",
              description: "Sign in to Aomi from the SDK.",
              body: <GuideLink href={SDK_GUIDE}>Open the SDK guide</GuideLink>,
              footnote: back,
            };

  return (
    <AomiSheet onClose={onClose}>
      <SheetHeader
        title={screen.title}
        description={screen.description}
        onClose={onClose}
      />
      <div className="flex flex-col items-center gap-4 px-5 pb-5">
        <ConnectionMark kind={app.kind} name={app.name} size={36} />
        {screen.body}
        <SheetFootnote>{screen.footnote}</SheetFootnote>
      </div>
    </AomiSheet>
  );
}
