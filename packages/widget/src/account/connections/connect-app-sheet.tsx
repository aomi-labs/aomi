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
  {
    name: "Other MCP client",
    kind: "ai",
    description: "Any agent that speaks MCP",
  },
];
const MORE: App[] = [
  { name: "Telegram", kind: "telegram", description: "Any Aomi bot" },
  { name: "Terminal", kind: "cli", description: "Aomi CLI" },
  { name: "Your own app", kind: "app", description: "SDK" },
];

const MCP_GUIDE = "https://aomi.dev/docs/guides/mcp";

/** Aomi's two MCP servers: talk to its agent, or drive its tools yourself. */
const MCP_SERVERS = [
  {
    title: "Agent MCP",
    path: "/v1/agent/mcp",
    detail:
      "Chat with Aomi's agent. It picks the tools, stages trades and asks before signing.",
  },
  {
    title: "Pipeline MCP",
    path: "/v1/pipeline/mcp",
    detail:
      "Your client's own model searches and calls Aomi's tools directly. For agents that plan for themselves.",
  },
];

function McpOption({
  title,
  path,
  detail,
}: {
  title: string;
  path: string;
  detail: string;
}) {
  return (
    <div className="border-aomi-border flex flex-col gap-2 rounded-[14px] border p-3">
      <div className="flex flex-col gap-0.5">
        <span className="type-row">{title}</span>
        <span className="type-meta text-aomi-muted">{detail}</span>
      </div>
      <CopyRow value={new URL(path, window.location.origin).href} />
    </div>
  );
}
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

  const other = app.name === "Other MCP client";
  const screen =
    app.kind === "ai"
      ? {
          title: other ? "Connect an MCP client" : `Connect ${app.name}`,
          description: `Add one of Aomi's MCP servers in ${other ? "your client" : app.name}.`,
          body: (
            <>
              <div className="flex w-full flex-col gap-3">
                {MCP_SERVERS.map((server) => (
                  <McpOption key={server.path} {...server} />
                ))}
              </div>
              <GuideLink href={MCP_GUIDE}>Open the setup guide</GuideLink>
            </>
          ),
          footnote: (
            <>
              {other ? "Your client" : app.name} opens Aomi to sign in. · {back}
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
