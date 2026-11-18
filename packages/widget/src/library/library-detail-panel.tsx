"use client";
import type { AomiPackage, AomiPublicPackage } from "@aomi-labs/client";
import { useState, type ReactNode } from "react";
import {
  ExternalLink,
  KeyRound,
  Loader2,
  Send,
  ShieldCheck,
  WandSparkles,
  Wrench,
} from "lucide-react";
import { AomiButton } from "@/ui/aomi/button";
import { StatusPill } from "@/ui/aomi/status-pill";
import { Switch } from "@/ui/aomi/switch";
import { Publisher } from "./catalog-row";
import { PackageTile } from "@/icons/package-mark";
import {
  askLines,
  connected,
  contentsLine,
  isAccountRow,
  needsConnect,
  noticeText,
  personSlots,
  reasonText,
} from "./model";

export function VerifiedPill({ verified }: { verified: boolean }) {
  return verified ? (
    <StatusPill tone="accent">Verified</StatusPill>
  ) : (
    <StatusPill tone="neutral">Not verified</StatusPill>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border-aomi-border border-t pt-5">
      <h3 className="type-eyebrow text-aomi-muted">{title}</h3>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

function IconLines({
  icon: Icon,
  tone = "text-aomi-accent",
  lines,
}: {
  icon: typeof Send;
  tone?: string;
  lines: string[];
}) {
  return (
    <ul className="type-control space-y-2">
      {lines.map((line) => (
        <li key={line} className="flex items-start gap-2">
          <Icon className={`${tone} mt-0.5 size-3.5 shrink-0`} />
          <span className="[overflow-wrap:anywhere]">{line}</span>
        </li>
      ))}
    </ul>
  );
}

/** Verified, not verified, or the person's key state when the package takes one. */
function AccessSection({
  row,
  agent,
  signedIn,
  busy,
  onClearChoice,
  onConnect,
  onDisconnect,
}: {
  row: AomiPackage;
  agent: string;
  signedIn: boolean;
  busy: boolean;
  onClearChoice: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  if (needsConnect(row))
    return (
      <DetailSection title="Access">
        <div className="flex flex-col items-start gap-2">
          <StatusPill>Needs your key</StatusPill>
          <IconLines
            icon={KeyRound}
            tone="text-aomi-muted"
            lines={[`Needs your ${row.display_name} key`]}
          />
        </div>
      </DetailSection>
    );
  if (connected(row))
    return (
      <DetailSection title="Access">
        <div className="flex flex-col items-start gap-2">
          <StatusPill tone="success" dot>
            Connected
          </StatusPill>
          <div className="-ml-2.5 flex gap-1">
            <AomiButton
              variant="ghost"
              size="sm"
              className="text-aomi-muted"
              disabled={busy || !signedIn}
              onClick={onConnect}
            >
              Replace key
            </AomiButton>
            <AomiButton
              variant="ghost"
              size="sm"
              className="text-aomi-danger hover:text-aomi-danger"
              disabled={busy || !signedIn}
              onClick={onDisconnect}
            >
              Disconnect
            </AomiButton>
          </div>
        </div>
      </DetailSection>
    );
  return (
    <DetailSection title="Access">
      <div className="flex items-center gap-2">
        <VerifiedPill verified={row.verified} />
        <span className="type-meta text-aomi-muted">
          {contentsLine(row)}. {reasonText(row, agent)}
        </span>
      </div>
      {personSlots(row).length > 0 && signedIn ? (
        <AomiButton
          variant="ghost"
          size="sm"
          className="text-aomi-muted -ml-2.5 mt-1"
          disabled={busy}
          onClick={onConnect}
        >
          <KeyRound /> Add your own key
        </AomiButton>
      ) : null}
      {row.choice !== null && signedIn ? (
        <AomiButton
          variant="ghost"
          size="sm"
          className="text-aomi-muted -ml-2.5 mt-1"
          disabled={busy}
          onClick={onClearChoice}
        >
          Use the default
        </AomiButton>
      ) : null}
    </DetailSection>
  );
}

export function LibraryDetailPanel({
  row,
  agent,
  signedIn,
  busy,
  error,
  onToggle,
  onClearChoice,
  onConnect,
  onDisconnect,
}: {
  /** A guest's public row shows what the package is, nothing tied to an account. */
  row: AomiPublicPackage;
  agent: string;
  signedIn: boolean;
  busy: boolean;
  error: string | null;
  /** `noticeShown`: the inspector already showed the not verified notice. */
  onToggle: (row: AomiPackage, enabled: boolean, noticeShown: boolean) => void;
  onClearChoice: (row: AomiPackage) => void;
  onConnect: (row: AomiPackage) => void;
  onDisconnect: (row: AomiPackage) => void;
}) {
  const account = isAccountRow(row) ? row : null;
  const asks = account ? askLines(account.envelope) : [];
  const notice = account !== null && !account.verified && !account.enabled;
  const [scrolled, setScrolled] = useState(false);
  return (
    <aside
      aria-label={`${row.display_name} details`}
      className="bg-aomi-raised border-aomi-border flex min-h-0 flex-1 flex-col md:border-l"
    >
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)}
      >
        {/* Once scrolled, content passes under this band, clear of the
            shell's close button (top 16px, 28px tall). */}
        <div
          aria-hidden
          className={`bg-aomi-raised pointer-events-none sticky top-0 z-10 -mb-8 h-[52px] ${scrolled ? "border-aomi-border border-b" : "invisible"}`}
        />
        <div className="px-5 pb-5 pt-1">
          <PackageTile iconUrl={row.icon_url} size="detail" />
          <h2 className="type-title mt-4">{row.display_name}</h2>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <span className="type-address text-aomi-muted">{row.id}</span>
            <span aria-hidden className="type-meta text-aomi-muted/60">
              ·
            </span>
            <Publisher row={row} />
          </div>
          <p className="type-control text-aomi-muted mt-2">{row.description}</p>
        </div>

        <div className="space-y-5 px-5 pb-9">
          {account ? (
            <AccessSection
              row={account}
              agent={agent}
              signedIn={signedIn}
              busy={busy}
              onClearChoice={() => onClearChoice(account)}
              onConnect={() => onConnect(account)}
              onDisconnect={() => onDisconnect(account)}
            />
          ) : null}

          {row.skills.length > 0 ? (
            <DetailSection title="What it contains">
              <ul className="space-y-2.5">
                {row.skills.map((skill) => (
                  <li key={skill.id} className="flex items-start gap-2">
                    <WandSparkles className="text-aomi-accent mt-0.5 size-3.5 shrink-0" />
                    <span className="type-control min-w-0">
                      <span className="font-medium">{skill.id}</span>
                      <span className="type-meta text-aomi-muted ml-1.5">
                        {skill.description}
                      </span>
                    </span>
                  </li>
                ))}
                <li className="type-control text-aomi-muted flex items-start gap-2">
                  <Wrench className="mt-0.5 size-3.5 shrink-0" />
                  {row.tool_count} tool{row.tool_count === 1 ? "" : "s"} load
                  when a skill is opened
                </li>
              </ul>
            </DetailSection>
          ) : null}

          {asks.length > 0 ? (
            <DetailSection title="Can ask you to">
              <IconLines icon={Send} lines={asks} />
            </DetailSection>
          ) : null}

          {account && account.envelope.hosts.length > 0 ? (
            <DetailSection title="Can reach">
              <ul className="space-y-1.5">
                {account.envelope.hosts.map((host) => (
                  <li
                    key={host}
                    className="flex items-center gap-2 font-mono text-[12px] leading-4"
                  >
                    <ExternalLink className="text-aomi-muted size-3 shrink-0" />
                    <span className="[overflow-wrap:anywhere]">{host}</span>
                  </li>
                ))}
              </ul>
            </DetailSection>
          ) : null}
        </div>
        {/* While more is below, the last lines fade into the strip; at the
            end the fade covers only the padding. */}
        <div
          aria-hidden
          className="from-aomi-raised pointer-events-none sticky bottom-0 -mt-6 h-6 bg-gradient-to-t to-transparent"
        />
      </div>

      {account ? (
        <div className="shrink-0 px-5 pb-5 pt-3">
          {error ? (
            <p
              role="alert"
              className="bg-aomi-surface-2 text-aomi-danger rounded-control type-meta mb-2.5 px-3 py-2"
            >
              {error}
            </p>
          ) : null}
          {needsConnect(account) ? (
            <AomiButton
              variant="primary"
              className="w-full"
              disabled={!signedIn || busy}
              onClick={() => onConnect(account)}
            >
              Connect
            </AomiButton>
          ) : (
            <>
              {notice ? (
                <div className="rounded-control bg-aomi-surface-2 type-meta text-aomi-fg/80 mb-2.5 flex items-start gap-2.5 px-3 py-2.5">
                  <ShieldCheck className="text-aomi-muted mt-px size-3.5 shrink-0" />
                  <span>{noticeText(account)}</span>
                </div>
              ) : null}
              <div className="bg-aomi-surface-2 rounded-control flex h-8 items-center justify-between gap-3 px-3">
                <span className="type-control font-medium">
                  {account.enabled ? "On in your chats" : "Off in your chats"}
                </span>
                {busy ? (
                  <Loader2 className="text-aomi-muted size-4 animate-spin" />
                ) : (
                  <Switch
                    checked={account.enabled}
                    disabled={!signedIn || account.agent_listed}
                    onCheckedChange={(enabled) =>
                      onToggle(account, enabled, notice)
                    }
                    aria-label={`${row.display_name} on in your chats`}
                    title={
                      account.agent_listed
                        ? reasonText(account, agent)
                        : !signedIn
                          ? "Sign in to change your packages"
                          : undefined
                    }
                  />
                )}
              </div>
            </>
          )}
        </div>
      ) : null}
    </aside>
  );
}
