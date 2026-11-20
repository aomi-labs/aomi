"use client";
import type { AomiPackage, AomiPublicPackage } from "@aomi-labs/client";
import { useState, type ReactNode } from "react";
import {
  ChevronDown,
  FileText,
  Loader2,
  Lock,
  Plus,
  Shield,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { AomiButton } from "@/ui/aomi/button";
import { SectionHeader } from "@/ui/aomi/section-header";
import { PackageTile } from "@/icons/package-mark";
import { Publisher } from "./catalog-row";
import {
  chainItem,
  isAccountRow,
  needsConnect,
  personSlots,
  shortDigest,
  walletLines,
} from "./model";

function Section({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <SectionHeader title={title} count={count} action={action} />
      {children}
    </section>
  );
}

/** Name over description, with an optional trailing status. */
function Lines({
  rows,
}: {
  rows: { key: string; name: string; description: string; status?: string }[];
}) {
  return (
    <ul className="border-aomi-border divide-aomi-border divide-y rounded-xl border">
      {rows.map((row) => (
        <li key={row.key} className="flex gap-3 px-3 py-2.5">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-mono text-[12px] leading-4 [overflow-wrap:anywhere]">
              {row.name}
            </span>
            {row.description ? (
              <span className="type-meta text-aomi-muted">
                {row.description}
              </span>
            ) : null}
          </span>
          {row.status ? (
            <span className="type-meta text-aomi-muted shrink-0">
              {row.status}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function WalletSection({ row }: { row: AomiPackage }) {
  const lines = walletLines(row);
  return (
    <Section title="Wallet">
      {lines.length === 0 ? (
        <p className="type-control text-aomi-fg/80 flex gap-2.5">
          <Shield className="text-aomi-muted mt-px size-4 shrink-0" />
          Never asks for a transaction or a signature.
        </p>
      ) : (
        lines.map(({ kind, icon: Icon, title, detail }) => (
          <div key={title} className="flex gap-2.5">
            <Icon
              className={cn(
                "mt-px size-4 shrink-0",
                kind === "guard"
                  ? "text-aomi-accent-strong"
                  : "text-aomi-muted",
              )}
            />
            <span className="flex min-w-0 flex-col">
              <span className="type-control">{title}</span>
              <span
                className={cn(
                  "type-meta text-aomi-muted",
                  kind === "guard" &&
                    "font-mono text-[11.5px] [overflow-wrap:anywhere]",
                )}
              >
                {detail}
              </span>
            </span>
          </div>
        ))
      )}
    </Section>
  );
}

/** The tool count; with the live release's tools, a toggle that lists them. */
function ToolsSection({ row }: { row: AomiPublicPackage }) {
  const [open, setOpen] = useState(false);
  const tools = isAccountRow(row) ? (row.tools ?? []) : [];
  if (tools.length === 0)
    return <SectionHeader title="Tools" count={row.tool_count} />;
  return (
    <section className="flex flex-col gap-2.5">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          className="flex min-h-7 w-full items-center gap-2 px-0.5 text-left"
        >
          <span className="type-section">Tools</span>
          <span className="type-meta text-aomi-muted tabular-nums">
            {tools.length}
          </span>
          <ChevronDown
            className={cn(
              "text-aomi-muted ml-auto size-3.5 transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
      </h3>
      {open ? (
        <Lines
          rows={tools.map((tool) => ({
            key: tool.name,
            name: tool.name,
            description: tool.description,
          }))}
        />
      ) : null}
    </section>
  );
}

/** State on the left, the one action on the right. */
function ActivationBar({
  row,
  busy,
  onToggle,
  onConnect,
  onSignIn,
}: {
  row: AomiPublicPackage;
  busy: boolean;
  onToggle: (row: AomiPackage, enabled: boolean) => void;
  onConnect: (row: AomiPackage) => void;
  onSignIn: () => void;
}) {
  if (!isAccountRow(row))
    return (
      <>
        <span className="text-aomi-muted">Sign in to turn it on</span>
        <AomiButton variant="primary" className="ml-auto" onClick={onSignIn}>
          Sign in
        </AomiButton>
      </>
    );
  if (row.agent_listed)
    return (
      <>
        <Lock className="text-aomi-muted size-3.5 shrink-0" />
        <span className="text-aomi-muted">Always on here</span>
      </>
    );
  const action = busy ? (
    <Loader2
      aria-label="Saving"
      className="text-aomi-muted size-4 animate-spin"
    />
  ) : needsConnect(row) ? (
    <AomiButton variant="primary" onClick={() => onConnect(row)}>
      Connect
    </AomiButton>
  ) : row.enabled ? (
    <AomiButton onClick={() => onToggle(row, false)}>Turn off</AomiButton>
  ) : (
    <AomiButton variant="primary" onClick={() => onToggle(row, true)}>
      Turn on
    </AomiButton>
  );
  return (
    <>
      {row.enabled ? (
        <>
          <span aria-hidden className="bg-aomi-success size-1.5 rounded-full" />
          <span className="font-medium">In your chats</span>
        </>
      ) : (
        <span className="text-aomi-muted">Not in your chats</span>
      )}
      <span className="ml-auto flex">{action}</span>
    </>
  );
}

export function LibraryDetailPanel({
  row,
  busy,
  error,
  onToggle,
  onConnect,
  onDisconnect,
  onSignIn,
}: {
  /** A guest's public row shows what the package is, nothing tied to an account. */
  row: AomiPublicPackage;
  busy: boolean;
  error: string | null;
  onToggle: (row: AomiPackage, enabled: boolean) => void;
  onConnect: (row: AomiPackage) => void;
  onDisconnect: (row: AomiPackage) => void;
  onSignIn: () => void;
}) {
  const account = isAccountRow(row) ? row : null;
  const keys = account ? personSlots(account) : [];
  const chains = row.chains.map(chainItem);
  const hosts = account?.envelope.hosts ?? [];
  const publisherKey = account?.slots.some((slot) => slot.owner === "builder");
  const [scrolled, setScrolled] = useState(false);
  return (
    <aside
      aria-label={`${row.display_name} details`}
      className="bg-aomi-raised border-aomi-border flex min-h-0 flex-1 flex-col md:border-l"
    >
      <div
        className="flex min-h-0 flex-1 flex-col overflow-y-auto"
        onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)}
      >
        {/* Once scrolled, content passes under this band, clear of the
            shell's close button (top 16px, 28px tall). */}
        <div
          aria-hidden
          className={`bg-aomi-raised pointer-events-none sticky top-0 z-10 -mb-8 h-[52px] shrink-0 ${scrolled ? "border-aomi-border border-b" : "invisible"}`}
        />
        <div className="flex flex-1 flex-col gap-6 px-6 pb-6 pt-1">
          <header>
            <div className="flex items-start gap-3 pr-8">
              <PackageTile iconUrl={row.icon_url} size="detail" />
              <div className="flex min-w-0 flex-col gap-0.5 pt-0.5">
                <h2 className="type-title [overflow-wrap:anywhere]">
                  {row.display_name}
                </h2>
                <Publisher row={row} />
              </div>
            </div>
            <p className="type-control text-aomi-fg/80 mt-3">
              {row.description}
            </p>
          </header>

          {account && keys.length > 0 ? (
            <Section
              title="Your keys"
              action={
                <>
                  {keys.some((slot) => slot.status === "ready") ? (
                    <AomiButton
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => onDisconnect(account)}
                    >
                      Remove keys
                    </AomiButton>
                  ) : null}
                  <AomiButton
                    size="sm"
                    disabled={busy}
                    onClick={() => onConnect(account)}
                  >
                    <Plus /> Add keys
                  </AomiButton>
                </>
              }
            >
              <Lines
                rows={keys.map((slot) => ({
                  key: slot.name,
                  name: slot.name,
                  description: slot.description,
                  status: slot.status === "ready" ? "Added" : "Not added",
                }))}
              />
            </Section>
          ) : null}

          {chains.length > 0 ? (
            <Section
              title="Chains"
              count={chains.length > 1 ? chains.length : undefined}
            >
              <ul className="flex flex-wrap gap-1.5">
                {chains.map(({ id, label, icon: Icon }) => (
                  <li
                    key={id}
                    className="border-aomi-border type-meta inline-flex h-[26px] items-center gap-1.5 rounded-full border px-2.5"
                  >
                    {Icon ? <Icon className="size-3.5 shrink-0" /> : null}
                    {label}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {account ? <WalletSection row={account} /> : null}

          {row.skills.length > 0 ? (
            <Section title="Skills" count={row.skills.length}>
              {row.skills.map((skill) => (
                <div key={skill.id} className="flex gap-2.5">
                  <span className="bg-aomi-surface-2 text-aomi-muted flex size-7 shrink-0 items-center justify-center rounded-[8px]">
                    <FileText className="size-3.5" />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="type-control font-medium">{skill.id}</span>
                    <span className="type-meta text-aomi-muted">
                      {skill.description}
                    </span>
                  </span>
                </div>
              ))}
            </Section>
          ) : null}

          {row.tool_count > 0 ? <ToolsSection row={row} /> : null}

          {hosts.length > 0 || publisherKey ? (
            <Section
              title="Connects to"
              count={hosts.length > 1 ? hosts.length : undefined}
            >
              {hosts.length > 0 ? (
                <ul className="text-aomi-fg/80 font-mono text-[12px] leading-5">
                  {hosts.map((host) => (
                    <li key={host} className="[overflow-wrap:anywhere]">
                      {host}
                    </li>
                  ))}
                </ul>
              ) : null}
              {publisherKey ? (
                <p className="type-meta text-aomi-muted">
                  The publisher provides the API key.
                </p>
              ) : null}
            </Section>
          ) : null}

          {account ? (
            <p className="type-meta text-aomi-muted mt-auto">
              Release {account.live.release} ·{" "}
              <span className="font-mono text-[11.5px]">
                {shortDigest(account.live.digest)}
              </span>
            </p>
          ) : null}
        </div>
        {/* While more is below, the last lines fade into the strip; at the
            end the fade covers only the padding. */}
        <div
          aria-hidden
          className="from-aomi-raised pointer-events-none sticky bottom-0 -mt-6 h-6 shrink-0 bg-gradient-to-t to-transparent"
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="bg-aomi-surface-2 text-aomi-danger rounded-control type-meta mx-6 mb-2 px-3 py-2"
        >
          {error}
        </p>
      ) : null}
      <div className="border-aomi-border type-control flex min-h-14 shrink-0 items-center gap-2 border-t px-6 py-3">
        <ActivationBar
          row={row}
          busy={busy}
          onToggle={onToggle}
          onConnect={onConnect}
          onSignIn={onSignIn}
        />
      </div>
    </aside>
  );
}
