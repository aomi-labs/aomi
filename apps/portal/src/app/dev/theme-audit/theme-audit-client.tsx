"use client";

import { type ReactNode } from "react";
import { ExternalLink, LineChart, Settings, Wallet, X } from "lucide-react";

import { usageFixture } from "@portal/features/usage/fixture";
import {
  Chip,
  MatrixTable,
  Meter,
  OutcomeTable,
  StatementSection,
  usd,
} from "@portal/features/usage/usage-shared";

import { AuditTable } from "./theme-audit-table";

const MONTH = usageFixture.months[0];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-aomi-muted text-[10px] font-semibold uppercase tracking-[0.14em]">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** The settings-modal chrome, verbatim from `settings-modal.tsx`. */
function ModalChrome() {
  const nav = [
    { label: "General", Icon: Settings, active: false },
    { label: "Account", Icon: Wallet, active: false },
    { label: "Usage", Icon: LineChart, active: true },
  ];
  return (
    <div
      className="border-aomi-border bg-aomi-raised text-aomi-fg relative flex overflow-hidden rounded-2xl border"
      style={{ height: 260 }}
    >
      <nav className="border-aomi-border bg-aomi-bg/40 flex w-[180px] flex-shrink-0 flex-col gap-0.5 border-r p-3 pt-[18px]">
        <span className="px-2.5 pb-3 pt-1 text-[15px] font-semibold">
          Settings
        </span>
        {nav.map(({ label, Icon, active }) => (
          <button
            key={label}
            className={`flex items-center gap-2.5 rounded-lg px-2.5 py-[9px] text-left transition-colors ${
              active ? "bg-aomi-accent-subtle" : "hover:bg-aomi-hover"
            }`}
          >
            <Icon
              className={`size-4 ${active ? "text-aomi-accent-strong" : "text-aomi-muted"}`}
            />
            <span
              className={`text-sm ${active ? "text-aomi-fg font-medium" : "text-aomi-muted"}`}
            >
              {label}
            </span>
          </button>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-aomi-border flex items-center justify-between border-b px-[22px] py-[18px]">
          <span className="text-base font-semibold">Usage</span>
          <button
            aria-label="Close settings"
            className="bg-aomi-surface-2 text-aomi-muted hover:bg-aomi-hover hover:text-aomi-fg flex h-8 w-8 items-center justify-center rounded-full transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="flex flex-col gap-3 p-[22px]">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold">Usage</span>
            <span className="text-aomi-muted text-[13px]">July 2026</span>
          </div>
          <div className="border-aomi-border flex items-center justify-between border-t pt-3">
            <div className="flex flex-col">
              <span className="text-[13px]">Models</span>
              <span className="text-aomi-muted text-[11px]">12 turns</span>
            </div>
            <span className="font-mono text-[13px]">{usd(0.3)}</span>
          </div>
          <div className="border-aomi-border flex items-center justify-between border-t pt-3">
            <span className="text-[13px] font-semibold">Total</span>
            <span className="font-mono text-[13px] font-semibold">
              {usd(0.3)}
            </span>
          </div>
          <div className="border-aomi-border flex flex-col gap-2 border-t pt-3">
            <span className="text-aomi-muted text-[12px]">
              Credits 30/500 · paid via app_key
            </span>
            <Meter pct={6} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** The General tab's segmented control + hairline grid, verbatim. */
function GeneralBits() {
  return (
    <div className="border-aomi-border bg-aomi-bg/40 overflow-hidden rounded-xl border">
      <div className="border-aomi-border bg-aomi-border grid grid-cols-2 gap-px border-t">
        {[
          ["Network", "Ethereum"],
          ["Status", "Active"],
        ].map(([k, v]) => (
          <div
            key={k}
            className="bg-aomi-bg/40 flex flex-col gap-0.5 px-4 py-3"
          >
            <span className="text-aomi-muted text-xs">{k}</span>
            <span className="flex items-center gap-[7px] text-[13px]">
              <span className="bg-aomi-success h-[7px] w-[7px] rounded-full" />
              {v}
            </span>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3 p-4">
        <div className="border-aomi-border bg-aomi-surface flex rounded-full border p-[3px]">
          {["Managed", "Bring your own key"].map((label, i) => (
            <button
              key={label}
              className={`flex-1 rounded-full px-3 py-1.5 text-[13px] transition-colors ${
                i === 0
                  ? "bg-aomi-accent-strong text-aomi-on-accent font-medium"
                  : "text-aomi-muted hover:text-aomi-fg"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="border-aomi-border flex items-center gap-[7px] rounded-lg border px-3 py-[7px]">
          <span className="bg-aomi-success h-[7px] w-[7px] rounded-full" />
          <span className="text-[13px]">Connected</span>
        </div>
        <div className="bg-aomi-border h-px" />
        <div className="flex gap-2">
          <button className="bg-aomi-fg text-aomi-bg rounded-full px-4 py-2 text-[13px] font-medium">
            Primary
          </button>
          <button className="border-aomi-border text-aomi-muted hover:text-aomi-fg rounded-full border px-4 py-2 text-[13px] font-medium transition-colors">
            Secondary
          </button>
          <button className="border-aomi-danger text-aomi-danger rounded-full border px-4 py-2 text-[13px] font-medium">
            Destructive
          </button>
        </div>
      </div>
    </div>
  );
}

function Specimens() {
  const outcomePairs = MONTH.apps
    .filter((a) => a.outcome)
    .flatMap((app) =>
      app.outcome ? app.outcome.items.map((item) => ({ app, item })) : [],
    )
    .slice(0, 3);

  return (
    <div className="bg-aomi-bg text-aomi-fg flex flex-col gap-8 p-6">
      <Section title="Settings modal — panel, dividers, meter, close button">
        <ModalChrome />
      </Section>

      <Section title="General — segmented control, hairline grid, buttons">
        <GeneralBits />
      </Section>

      <Section title="By-app matrix (framed)">
        <MatrixTable month={MONTH} framed />
      </Section>

      <Section title="By-app matrix (frameless, on panel)">
        <div className="bg-aomi-raised rounded-xl p-4">
          <MatrixTable month={MONTH} />
        </div>
      </Section>

      <Section title="Statement section + outcome table">
        <StatementSection
          title="On-chain outcomes"
          subtitle="settled in-token"
          total={usd(MONTH.summary.outcomeUsd)}
        >
          <OutcomeTable pairs={outcomePairs} />
        </StatementSection>
      </Section>

      <Section title="Chips, badges, meters">
        <div className="border-aomi-border flex flex-col gap-4 rounded-xl border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Chip>native · base</Chip>
            <Chip>app key · model free</Chip>
            <Chip accent>managed · +12%</Chip>
            <span className="border-aomi-border bg-aomi-surface-2 text-aomi-muted rounded-lg border px-1.5 py-0.5 text-[10px] font-medium">
              base
            </span>
            <span className="text-aomi-accent flex items-center gap-1 font-mono text-[11px]">
              0x7A3f…9C21
              <ExternalLink size={11} />
            </span>
          </div>
          <Meter pct={22} />
          <Meter pct={96} over />
        </div>
      </Section>

      <Section title="Elevation ramp — each step must read off the one below">
        <div className="bg-aomi-bg border-aomi-border rounded-xl border p-3">
          <div className="bg-aomi-surface border-aomi-border rounded-lg border p-3 text-[12px]">
            surface <span className="text-aomi-muted">· recessed</span>
            <div className="bg-aomi-raised border-aomi-border mt-2 rounded-lg border p-3">
              raised <span className="text-aomi-muted">· panels</span>
              <div className="bg-aomi-surface-2 border-aomi-border mt-2 rounded-lg border p-3">
                surface-2{" "}
                <span className="text-aomi-muted">· fills on a panel</span>
                <div className="bg-aomi-hover border-aomi-border mt-2 rounded-lg border p-3">
                  hover
                </div>
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Tooltip (overlay border)">
        <div className="border-aomi-overlay-border bg-aomi-surface-2 text-aomi-fg inline-block rounded-lg border px-2.5 py-1.5 text-[11px]">
          12 turns
        </div>
      </Section>
    </div>
  );
}

/* ====================================================================== */
/* Page                                                                    */
/* ====================================================================== */

export function ThemeAuditClient() {
  // Both panes scope their own theme (`.light` / `.dark`), so this page never
  // touches the root class — `useSettings` owns it, and fighting it there just
  // ping-pongs with its effect.
  return (
    <div className="h-full overflow-y-auto bg-white text-zinc-900">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-10 p-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Theme audit</h1>
          <p className="text-sm text-zinc-500">
            Static fixtures — no account required. Light and dark render the
            same markup side by side.
          </p>
        </header>

        <AuditTable />

        <div>
          <h2 className="mb-3 text-lg font-semibold">Surfaces</h2>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <div className="light overflow-hidden rounded-2xl border border-zinc-300">
              <div className="border-b border-zinc-300 bg-zinc-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-600">
                Light
              </div>
              <Specimens />
            </div>
            <div className="dark overflow-hidden rounded-2xl border border-zinc-700">
              <div className="border-b border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Dark
              </div>
              <Specimens />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
