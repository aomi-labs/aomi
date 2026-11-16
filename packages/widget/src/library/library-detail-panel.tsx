"use client";
import type { AomiPackage, AomiPackageSlot } from "@aomi-labs/client";
import { createElement, useState, type ReactNode } from "react";
import {
  Globe,
  KeyRound,
  Loader2,
  Send,
  ShieldCheck,
  Trash2,
  WandSparkles,
  Wrench,
} from "lucide-react";
import { getSkillIcon } from "@/icons/skills/skill-icons";
import { AomiButton } from "@/ui/aomi/button";
import { StatusPill } from "@/ui/aomi/status-pill";
import { Switch } from "@/ui/aomi/switch";
import { PackageIcon } from "./package-row";
import {
  askLines,
  contentsLine,
  personSlots,
  publisher,
  reasonText,
} from "./model";

export function SkillIdentity({
  skillId,
  size = "row",
}: {
  skillId: string;
  size?: "row" | "detail";
}) {
  const Icon = getSkillIcon(skillId) ?? WandSparkles;
  return (
    <span
      className={`border-aomi-overlay-border bg-aomi-surface-2 text-aomi-accent flex shrink-0 items-center justify-center rounded-xl border ${
        size === "detail" ? "size-12" : "size-9"
      }`}
    >
      {createElement(Icon, {
        className: size === "detail" ? "size-7" : "size-5",
      })}
    </span>
  );
}

export function VerifiedPill({ verified }: { verified: boolean }) {
  return verified ? (
    <StatusPill tone="success">
      <ShieldCheck className="size-3" /> Verified
    </StatusPill>
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
  lines,
}: {
  icon: typeof Send;
  lines: string[];
}) {
  return (
    <ul className="type-control space-y-1.5">
      {lines.map((line) => (
        <li key={line} className="flex items-start gap-2">
          <Icon className="text-aomi-accent mt-0.5 size-3.5 shrink-0" />
          <span className="[overflow-wrap:anywhere]">{line}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The person's own keys for a package. A value is entered in a hidden input,
 * stored on the account, and never shown again; builder keys are only
 * explained here.
 */
function PackageKeys({
  row,
  signedIn,
  onSave,
  onRemove,
}: {
  row: AomiPackage;
  signedIn: boolean;
  onSave: (slot: string, value: string) => Promise<boolean>;
  onRemove: (slot: string) => Promise<boolean>;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const person = personSlots(row);
  const builder = row.slots.filter((slot) => slot.owner === "builder");
  const pending = Object.entries(drafts).filter(([, value]) => value.trim());

  const save = async () => {
    setBusy("save");
    for (const [slot, value] of pending) {
      if (!(await onSave(slot, value.trim()))) break;
      setDrafts((current) => ({ ...current, [slot]: "" }));
    }
    setBusy(null);
  };
  const remove = async (slot: string) => {
    setBusy(slot);
    await onRemove(slot);
    setBusy(null);
  };

  const status = (slot: AomiPackageSlot) =>
    `${slot.required ? "Required" : "Optional"}${slot.status === "ready" ? " · Saved" : ""}`;

  return (
    <DetailSection title="Keys">
      <div className="space-y-3">
        {person.length > 0 ? (
          <div className="flex items-start gap-2">
            <KeyRound className="text-aomi-muted mt-0.5 size-3.5 shrink-0" />
            <p className="type-meta">
              {signedIn
                ? "Use your own key for this package. Saved values are never shown again."
                : "Sign in to add your own key."}
            </p>
          </div>
        ) : null}
        {person.map((slot) => (
          <div key={slot.name} className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor={`package-key-${row.package_id}-${slot.name}`}
                className="type-address min-w-0 truncate font-medium"
              >
                {slot.name}
              </label>
              <span className="type-meta text-aomi-muted shrink-0">
                {status(slot)}
              </span>
            </div>
            {slot.description ? (
              <p className="type-meta text-aomi-muted">{slot.description}</p>
            ) : null}
            <div className="flex gap-1.5">
              <input
                id={`package-key-${row.package_id}-${slot.name}`}
                aria-label={slot.name}
                type="password"
                autoComplete="new-password"
                value={drafts[slot.name] ?? ""}
                placeholder={
                  slot.status === "ready" ? "Enter replacement" : "Enter value"
                }
                disabled={busy !== null || !signedIn}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [slot.name]: event.target.value,
                  }))
                }
                className="border-aomi-border bg-aomi-bg placeholder:text-aomi-muted rounded-control type-control h-8 min-w-0 flex-1 border px-2.5 outline-none focus:border-current disabled:opacity-50"
              />
              {slot.status === "ready" ? (
                <AomiButton
                  variant="danger"
                  size="icon"
                  aria-label={`Remove ${slot.name}`}
                  title={`Remove ${slot.name}`}
                  disabled={busy !== null || !signedIn}
                  onClick={() => void remove(slot.name)}
                >
                  {busy === slot.name ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Trash2 />
                  )}
                </AomiButton>
              ) : null}
            </div>
          </div>
        ))}
        {person.length > 0 ? (
          <AomiButton
            variant="primary"
            onClick={() => void save()}
            disabled={busy !== null || !signedIn || pending.length === 0}
            className="w-full"
          >
            {busy === "save" ? (
              <Loader2 className="animate-spin" />
            ) : (
              "Save key"
            )}
          </AomiButton>
        ) : null}
        {builder.map((slot) => (
          <div key={slot.name} className="space-y-0.5">
            <div className="flex items-center justify-between gap-2">
              <span className="type-address min-w-0 truncate font-medium">
                {slot.name}
              </span>
              <span className="type-meta text-aomi-muted shrink-0">
                {slot.status === "ready" ? "Set by the builder" : "Not set yet"}
              </span>
            </div>
            <p className="type-meta text-aomi-muted">
              {slot.description ||
                "The builder holds this key; you don’t need to add anything."}
            </p>
          </div>
        ))}
      </div>
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
  onSaveKey,
  onRemoveKey,
}: {
  row: AomiPackage | null;
  agent: string;
  signedIn: boolean;
  busy: boolean;
  error: string | null;
  onToggle: (row: AomiPackage, enabled: boolean) => void;
  onClearChoice: (row: AomiPackage) => void;
  onSaveKey: (
    row: AomiPackage,
    slot: string,
    value: string,
  ) => Promise<boolean>;
  onRemoveKey: (row: AomiPackage, slot: string) => Promise<boolean>;
}) {
  const asks = row ? askLines(row.envelope) : [];
  return (
    <aside
      aria-label={row ? `${row.display_name} details` : "Package details"}
      className="bg-aomi-raised border-aomi-border flex min-h-0 flex-1 flex-col md:border-l"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-5">
        {!row ? (
          <div className="type-control text-aomi-muted flex flex-1 items-center justify-center px-6 text-center">
            Select a package to see its details.
          </div>
        ) : (
          <>
            <div className="px-5 pb-5 pt-1">
              <PackageIcon row={row} size="detail" />
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <h2 className="type-title">{row.display_name}</h2>
                <VerifiedPill verified={row.verified} />
              </div>
              <p className="type-meta text-aomi-muted mt-1 font-mono">
                {row.id} · by {publisher(row)}
              </p>
              <p className="type-control text-aomi-muted mt-2">
                {row.description}
              </p>
            </div>

            <div className="space-y-5 px-5">
              <DetailSection title="Access">
                <p className="type-control">
                  {contentsLine(row)}. {reasonText(row, agent)}
                </p>
                {row.choice !== null && signedIn ? (
                  <AomiButton
                    variant="ghost"
                    size="sm"
                    className="text-aomi-muted -ml-2 mt-1"
                    disabled={busy}
                    onClick={() => onClearChoice(row)}
                  >
                    Use the default
                  </AomiButton>
                ) : null}
              </DetailSection>

              {row.skills.length > 0 ? (
                <DetailSection title="What it contains">
                  <ul className="space-y-2">
                    {row.skills.map((skill) => (
                      <li key={skill.id} className="flex items-start gap-2">
                        <WandSparkles className="text-aomi-accent mt-0.5 size-3.5 shrink-0" />
                        <span className="min-w-0">
                          <span className="type-control block font-medium">
                            {skill.id}
                          </span>
                          <span className="type-meta text-aomi-muted block">
                            {skill.description}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="type-meta text-aomi-muted mt-2 flex items-center gap-2">
                    <Wrench className="size-3.5" />
                    {row.tool_count} tool{row.tool_count === 1 ? "" : "s"} load
                    when a skill is opened
                  </p>
                </DetailSection>
              ) : null}

              {asks.length > 0 ? (
                <DetailSection title="Can ask you to">
                  <IconLines icon={Send} lines={asks} />
                </DetailSection>
              ) : null}

              {row.envelope.hosts.length > 0 ? (
                <DetailSection title="Can reach">
                  <IconLines icon={Globe} lines={row.envelope.hosts} />
                </DetailSection>
              ) : null}

              {row.slots.length > 0 ? (
                <PackageKeys
                  key={row.package_id}
                  row={row}
                  signedIn={signedIn}
                  onSave={(slot, value) => onSaveKey(row, slot, value)}
                  onRemove={(slot) => onRemoveKey(row, slot)}
                />
              ) : null}
            </div>

            <div className="mt-auto space-y-2 px-5 pb-5 pt-3">
              {error ? (
                <p
                  role="alert"
                  className="bg-aomi-surface-2 text-aomi-danger rounded-control type-meta px-3 py-2"
                >
                  {error}
                </p>
              ) : null}
              <div className="bg-aomi-surface-2 rounded-control flex h-8 items-center justify-between px-3">
                <span className="type-control font-medium">
                  {row.enabled ? "On in your chats" : "Off in your chats"}
                </span>
                {busy ? (
                  <Loader2 className="text-aomi-muted size-4 animate-spin" />
                ) : (
                  <Switch
                    checked={row.enabled}
                    disabled={!signedIn || row.agent_listed}
                    onCheckedChange={(enabled) => onToggle(row, enabled)}
                    aria-label={`${row.display_name} on in your chats`}
                    title={
                      row.agent_listed
                        ? reasonText(row, agent)
                        : !signedIn
                          ? "Sign in to change your packages"
                          : undefined
                    }
                  />
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
