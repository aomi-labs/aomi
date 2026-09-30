"use client";

// Telegram bot management for the Integrations page: provider rail, the
// how-it-works explainer, an inline add flow, and one card per registered
// bot with in-place app editing. UI ported from the /mock-integration design
// session; data layer (react-query + BFF operate/bots routes) unchanged.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, Star, Trash2 } from "lucide-react";
import { useCallback, useId, useMemo, useState } from "react";
import type React from "react";
import { useGitHubSession } from "@build/components/control-plane/github-session-context";
import {
  GitHubSignInPanel,
  LoadingPanel,
} from "@build/features/launch/components/deployments/ui/state-panels";
import {
  buildQueryKeys,
  buildQueryStaleTime,
  githubAccountKey,
} from "@build/features/launch/query-keys";
import { TelegramHowItWorks } from "@build/features/integrations/how-it-works";
import { ThreadModeControl } from "@build/features/integrations/thread-mode-control";
import { API_PATHS } from "@build/lib/api-paths";
import { cn } from "@build/lib/utils";
import { operateFetch } from "./client";

type BotProjectApp = {
  id: number;
  name: string;
  isActive: boolean;
};

type BotProject = {
  id: number;
  repositoryLink?: string | null;
  githubAccount?: string | null;
  apps?: BotProjectApp[];
};

type Bot = {
  id: string;
  platform: string;
  status: string;
  label?: string | null;
  handoverApp: string;
  /** null = the Aomi platform default. */
  miniAppUrl?: string | null;
  /** null = custom commands unsupported. */
  commandEndpoint?: string | null;
  commands?: string[];
  apps?: BotApp[];
  platformBotId?: string;
  platformUsername?: string | null;
  webhookUrl?: string | null;
  threadMode: string;
  /** Bumped by the manager on every change; the card is keyed on it. */
  configurationVersion?: number;
  createdAt: number;
};

type BotApp = {
  applicationId: number;
  projectId: number | null;
  projectLabel: string | null;
  name: string;
  label: string;
  isPrimary: boolean;
};

type BotsPayload = {
  projects?: BotProject[];
  bots?: Bot[];
};

/** The BFF's `/operate/bots/:id/webhook` result: Telegram's registered
 *  webhook compared with Aomi's, plus Telegram's own delivery stats. */
type WebhookCheck = {
  urlMatches: boolean;
  pendingUpdateCount: number;
  lastErrorMessage: string | null;
  reasserted: boolean;
  warning?: string | null;
};

type AppOption = {
  applicationId: number;
  name: string;
  projectLabel: string;
};

type Draft = {
  selected: number[];
  /** The handover app: new chats start here. */
  primary: number | null;
};

/** Bot-level command config as typed. Only fields that differ from the
 *  seed are sent, so an untouched card never rewrites what the manager has. */
type CommandDraft = {
  miniAppUrl: string;
  commandEndpoint: string;
  commands: string;
};

/** The PATCH/POST fragment for a command draft: URL fields send `null` when
 *  cleared, `commands` is the normalised list. Fields whose seed matches are
 *  omitted (= unchanged). */
function commandPatch(
  draft: CommandDraft,
  seed: CommandDraft,
): {
  miniAppUrl?: string | null;
  commandEndpoint?: string | null;
  commands?: string[];
} {
  const url = (value: string) => value.trim() || null;
  return {
    ...(url(draft.miniAppUrl) !== url(seed.miniAppUrl)
      ? { miniAppUrl: url(draft.miniAppUrl) }
      : {}),
    ...(url(draft.commandEndpoint) !== url(seed.commandEndpoint)
      ? { commandEndpoint: url(draft.commandEndpoint) }
      : {}),
    ...(commandList(draft.commands).join(" ") !==
    commandList(seed.commands).join(" ")
      ? { commands: commandList(draft.commands) }
      : {}),
  };
}

function commandSeed(bot?: Bot): CommandDraft {
  return {
    miniAppUrl: bot?.miniAppUrl ?? "",
    commandEndpoint: bot?.commandEndpoint ?? "",
    commands: (bot?.commands ?? []).join(", "),
  };
}

function commandList(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((command) => command.trim().replace(/^\/+/, "").toLowerCase())
    .filter(Boolean);
}

function projectLabel(project: BotProject) {
  return (
    project.repositoryLink || project.githubAccount || `Project ${project.id}`
  );
}

function displayBotName(bot: Bot): string {
  if (bot.label?.trim()) return bot.label;
  if (bot.platformUsername?.trim()) return `@${bot.platformUsername}`;
  return bot.platformBotId ?? bot.id;
}

function maskedToken(bot: Bot): string {
  return `${bot.platformBotId ?? bot.id}:••••••••••••`;
}

function monogram(bot: Bot): string {
  const name = bot.label ?? bot.platformUsername ?? bot.platformBotId ?? "bot";
  const parts = name
    .replace(/^@/, "")
    .split(/[_\s-]+/)
    .filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "B";
}

function threadModeLabel(threadMode: string): string {
  return threadMode === "multi" ? "Multiple threads" : "Single thread";
}

function botsUrl(extra: Record<string, string> = {}): string {
  const params = new URLSearchParams(extra);
  const query = params.toString();
  return query
    ? `${API_PATHS.bff.operate.bots}?${query}`
    : API_PATHS.bff.operate.bots;
}

// ── shared glyphs (recipes shared with providers-view.tsx) ──────────────────

const TH =
  "px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.07em] text-dim";

function CheckboxGlyph({
  checked,
  disabled,
}: {
  checked: boolean;
  disabled?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
        checked
          ? "bg-accent-selected text-accent-selected-foreground border-transparent"
          : "border-border-hover bg-transparent",
        disabled && "opacity-40",
      )}
    >
      {checked ? <Check className="size-3" /> : null}
    </span>
  );
}

function RadioGlyph({
  checked,
  disabled,
}: {
  checked: boolean;
  disabled?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
        checked ? "border-accent-selected" : "border-border-hover",
        disabled && "opacity-40",
      )}
    >
      {checked ? (
        <span className="bg-accent-selected size-2 rounded-full" />
      ) : null}
    </span>
  );
}

// ── app mapping table ───────────────────────────────────────────────────────

function AppTable({
  options,
  draft,
  onChange,
  ghostApps,
  disabled,
}: {
  options: AppOption[];
  draft: Draft;
  onChange: (next: Draft) => void;
  ghostApps?: BotApp[];
  disabled?: boolean;
}) {
  const toggle = (id: number) => {
    const selected = draft.selected.includes(id)
      ? draft.selected.filter((v) => v !== id)
      : [...draft.selected, id];
    const primary =
      draft.primary !== null && selected.includes(draft.primary)
        ? draft.primary
        : (selected.find((v) =>
            options.some((option) => option.applicationId === v),
          ) ?? null);
    onChange({ selected, primary });
  };

  const ghostSelected = (ghostApps ?? []).filter((app) =>
    draft.selected.includes(app.applicationId),
  );

  return (
    <div>
      <div className="border-border bg-surface-1 overflow-hidden rounded-sm border">
        <table className="w-full table-fixed text-[13px]">
          <thead className="border-border border-b">
            <tr>
              <th className={cn(TH, "w-11")} aria-label="Attached" />
              <th className={TH}>App</th>
              <th className={TH}>Project</th>
              <th className={cn(TH, "w-28")}>Handover app</th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {options.map((app) => {
              const isChecked = draft.selected.includes(app.applicationId);
              const isPrimary = draft.primary === app.applicationId;
              return (
                <tr
                  key={app.applicationId}
                  className={cn(
                    "transition-colors",
                    isChecked ? "bg-accent" : "hover:bg-surface-2/60",
                  )}
                >
                  <td className="px-3 py-2.5">
                    <label className="flex cursor-pointer items-center">
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={isChecked}
                        disabled={disabled}
                        onChange={() => toggle(app.applicationId)}
                        aria-label={`Attach ${app.name} (${app.projectLabel})`}
                      />
                      <CheckboxGlyph checked={isChecked} />
                    </label>
                  </td>
                  <td
                    className={cn(
                      "text-foreground truncate px-3 py-2.5",
                      isChecked && "font-medium",
                    )}
                  >
                    {app.name}
                  </td>
                  <td className="text-dim truncate px-3 py-2.5 font-mono text-xs">
                    {app.projectLabel}
                  </td>
                  <td className="px-3 py-2.5">
                    <label
                      className={cn(
                        "flex items-center",
                        isChecked ? "cursor-pointer" : "cursor-not-allowed",
                      )}
                    >
                      <input
                        type="radio"
                        name={`primary-app-${options[0]?.applicationId ?? "none"}`}
                        className="sr-only"
                        checked={isPrimary}
                        disabled={disabled || !isChecked}
                        onChange={() =>
                          onChange({ ...draft, primary: app.applicationId })
                        }
                        aria-label={`Make ${app.name} (${app.projectLabel}) the handover app`}
                      />
                      <RadioGlyph checked={isPrimary} disabled={!isChecked} />
                    </label>
                  </td>
                </tr>
              );
            })}
            {(ghostApps ?? []).map((app) => {
              const isChecked = draft.selected.includes(app.applicationId);
              return (
                <tr key={app.applicationId} className="bg-surface-2/40">
                  <td className="px-3 py-2.5">
                    <label
                      className={cn(
                        "flex items-center",
                        isChecked ? "cursor-pointer" : "cursor-not-allowed",
                      )}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={isChecked}
                        disabled={disabled || !isChecked}
                        onChange={() => toggle(app.applicationId)}
                        aria-label={`Detach ${app.name} (no longer available)`}
                      />
                      <CheckboxGlyph
                        checked={isChecked}
                        disabled={!isChecked}
                      />
                    </label>
                  </td>
                  <td className="text-dim truncate px-3 py-2.5">{app.name}</td>
                  <td className="text-dim truncate px-3 py-2.5 font-mono text-xs">
                    {app.projectLabel ?? "—"}
                  </td>
                  <td className="text-warning px-3 py-2.5 text-[11px]">
                    no longer available
                  </td>
                </tr>
              );
            })}
            {options.length === 0 && (ghostApps ?? []).length === 0 ? (
              <tr>
                <td colSpan={4} className="text-dim px-3 py-6 text-center">
                  No deployed apps available for this account.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="text-dim mt-2 text-[11px]">
        Handover app: new chats start here.
      </p>
      {ghostSelected.length > 0 ? (
        <p className="text-warning mt-2 text-xs">
          Uncheck the apps that are no longer available to save.
        </p>
      ) : null}
    </div>
  );
}

// ── provider rail ───────────────────────────────────────────────────────────

function ProviderRail({
  botCount,
  onAdd,
  addOpen,
}: {
  botCount: number;
  onAdd: () => void;
  addOpen: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="border-accent-selected/40 bg-surface-1 flex items-center gap-2 rounded-full border px-4 py-2">
        <svg
          viewBox="0 0 24 24"
          className="size-4 text-[#2AABEE]"
          fill="currentColor"
          aria-hidden
        >
          <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
        </svg>
        <span className="text-foreground text-[13px] font-medium">
          Telegram
        </span>
        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
          {botCount} {botCount === 1 ? "bot" : "bots"}
        </span>
      </div>
      <div className="border-border bg-surface-1 flex items-center gap-2 rounded-full border px-4 py-2 opacity-55">
        <svg
          viewBox="0 0 24 24"
          className="size-4 text-[#5865F2]"
          fill="currentColor"
          aria-hidden
        >
          <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03Z" />
        </svg>
        <span className="text-[13px]">Discord</span>
        <span className="border-border text-dim rounded-full border px-2 py-0.5 text-[10px] font-medium">
          Soon
        </span>
      </div>
      <div className="border-border bg-surface-1 flex items-center gap-2 rounded-full border px-4 py-2 opacity-55">
        <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
          <path
            fill="#E01E5A"
            d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z"
          />
          <path
            fill="#36C5F0"
            d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z"
          />
          <path
            fill="#2EB67D"
            d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z"
          />
          <path
            fill="#ECB22E"
            d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"
          />
        </svg>
        <span className="text-[13px]">Slack</span>
        <span className="border-border text-dim rounded-full border px-2 py-0.5 text-[10px] font-medium">
          Soon
        </span>
      </div>
      {!addOpen ? (
        <button
          type="button"
          onClick={onAdd}
          className="bg-foreground text-background ml-auto flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium"
        >
          <Plus className="size-4" aria-hidden />
          Add bot
        </button>
      ) : null}
    </div>
  );
}

// ── bot card ────────────────────────────────────────────────────────────────

function BotCommandFields({
  draft,
  onChange,
  disabled,
  children,
}: {
  draft: CommandDraft;
  onChange: (next: CommandDraft) => void;
  disabled?: boolean;
  /** Extra control rendered under the fields (the reveal-secret row). */
  children?: React.ReactNode;
}) {
  const id = useId();
  const field = (
    key: keyof CommandDraft,
    label: string,
    input: { type: "url" | "text"; placeholder: string },
    help: string,
  ) => (
    <div className="space-y-2 text-xs">
      <label htmlFor={`${id}-${key}`} className="text-dim block text-[13px]">
        {label}
      </label>
      <input
        id={`${id}-${key}`}
        type={input.type}
        placeholder={input.placeholder}
        value={draft[key]}
        disabled={disabled}
        onChange={(event) => onChange({ ...draft, [key]: event.target.value })}
        className="border-border bg-surface text-foreground h-9 w-full rounded-md border px-3 text-xs"
      />
      <p className="text-dim text-[11px]">{help}</p>
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        {field(
          "miniAppUrl",
          "Mini App URL",
          { type: "url", placeholder: "Aomi default" },
          "Opened by /wallet. Leave blank for the Aomi default.",
        )}
        {field(
          "commandEndpoint",
          "Command endpoint",
          { type: "url", placeholder: "https://api.example.com/commands" },
          "Custom commands post to this URL as /{command}.",
        )}
        {field(
          "commands",
          "Custom commands",
          { type: "text", placeholder: "b, p, r, chart" },
          "Custom commands are handled by the bot's command service, without an agent turn.",
        )}
      </div>
      {commandList(draft.commands).length > 0 &&
      !draft.commandEndpoint.trim() ? (
        <p className="text-warning text-xs">
          Custom commands need a command endpoint.
        </p>
      ) : null}
      {children}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const active = status === "active";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium",
        active
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : "border-border text-dim border",
      )}
    >
      {active ? <Check className="size-3" aria-hidden /> : null}
      {active ? "Active" : status}
    </span>
  );
}

function BotCard({
  bot,
  options,
  editing,
  onBeginEdit,
  onCancel,
  onSave,
  onRemove,
  removing,
  warning,
  onWebhookChecked,
}: {
  bot: Bot;
  options: AppOption[];
  editing: boolean;
  onBeginEdit: () => void;
  onCancel: () => void;
  onSave: (
    draft: Draft,
    threadMode: string,
    commandConfig: ReturnType<typeof commandPatch>,
  ) => Promise<void>;
  onRemove: () => void;
  removing: boolean;
  /** The manager saved the last edit but could not re-point the Telegram
   *  webhook; shown until a check reports fresh state. */
  warning: string | null;
  /** A check returned fresh state: the parent drops the saved warning so a
   *  later remount cannot bring it back. */
  onWebhookChecked: () => void;
}) {
  const mapped = useMemo(() => bot.apps ?? [], [bot.apps]);
  const initialDraft = useMemo<Draft>(
    () => ({
      selected: mapped.map((app) => app.applicationId),
      primary:
        mapped.find((app) => app.isPrimary)?.applicationId ??
        mapped[0]?.applicationId ??
        null,
    }),
    [mapped],
  );
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [draftThreadMode, setDraftThreadMode] = useState(bot.threadMode);
  // Seeded from the bot, never from an app: the config is bot-level.
  const seed = commandSeed(bot);
  const [commandDraft, setCommandDraft] = useState<CommandDraft>(seed);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shown once per edit session; never logged, never cached in react-query.
  const [secret, setSecret] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  // Last "Check webhook" result for this mount; the row is keyed on the
  // configuration version, so a save clears it along with the drafts.
  const [webhook, setWebhook] = useState<WebhookCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  // Apps still mapped to this bot but gone from the builder's projects. They
  // render as uncheckable-only rows: keeping one selected would 403 at the
  // BFF ownership check, so save stays blocked until they are unchecked.
  const ghostApps = useMemo(() => {
    const available = new Set(options.map((option) => option.applicationId));
    return mapped.filter((app) => !available.has(app.applicationId));
  }, [mapped, options]);

  const ghostStillSelected = ghostApps.some((app) =>
    draft.selected.includes(app.applicationId),
  );
  const canSave =
    draft.selected.length > 0 &&
    draft.primary !== null &&
    !ghostStillSelected &&
    (commandList(commandDraft.commands).length === 0 ||
      commandDraft.commandEndpoint.trim().length > 0) &&
    !saving;

  const displayName = displayBotName(bot);

  return (
    <div
      className={cn(
        "border-border bg-surface-1 rounded-md border",
        editing && "border-border-hover",
      )}
    >
      <div className="flex flex-wrap items-center gap-4 px-5 py-5">
        <div className="bg-accent text-accent-selected flex size-9 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold">
          {monogram(bot)}
        </div>
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-foreground text-sm font-medium">
              {displayName}
            </span>
            {bot.label && bot.platformUsername ? (
              <span className="text-dim text-xs">@{bot.platformUsername}</span>
            ) : null}
            <StatusPill status={bot.status} />
          </div>
          <div className="text-dim font-mono text-[11px]">
            {maskedToken(bot)}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2.5">
          <span className="text-dim text-xs">
            {threadModeLabel(bot.threadMode)}
          </span>
          {editing ? (
            <span className="text-accent-selected text-xs font-medium">
              Editing
            </span>
          ) : (
            <>
              <button
                type="button"
                onClick={onBeginEdit}
                disabled={removing}
                className="border-border hover:bg-accent-hover text-foreground h-8 rounded-full border px-3.5 text-xs font-medium disabled:opacity-50"
              >
                Change apps
              </button>
              <button
                type="button"
                onClick={onRemove}
                disabled={removing}
                aria-label={`Remove ${displayName}`}
                className="border-border hover:bg-accent-hover text-dim flex size-8 items-center justify-center rounded-full border disabled:opacity-50"
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </>
          )}
        </div>
      </div>

      {editing ? (
        <div className="border-border border-t p-5">
          <div className="mb-3 flex justify-end">
            <ThreadModeControl
              value={draftThreadMode}
              onChange={setDraftThreadMode}
              disabled={saving}
            />
          </div>
          <AppTable
            options={options}
            draft={draft}
            onChange={setDraft}
            ghostApps={ghostApps}
            disabled={saving}
          />
          <div className="mt-5">
            <BotCommandFields
              draft={commandDraft}
              onChange={setCommandDraft}
              disabled={saving}
            >
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={saving || revealing}
                  onClick={() => {
                    setRevealing(true);
                    setError(null);
                    fetch(API_PATHS.bff.operate.botCommandSecret(bot.id))
                      .then(async (res) => {
                        const json = (await res.json().catch(() => ({}))) as {
                          commandSecret?: string;
                          error?: string;
                        };
                        if (!res.ok || !json.commandSecret) {
                          throw new Error(
                            json.error ||
                              `Failed to reveal secret (${res.status})`,
                          );
                        }
                        setSecret(json.commandSecret);
                      })
                      .catch((err: unknown) => {
                        setError(
                          err instanceof Error
                            ? err.message
                            : "Failed to reveal secret",
                        );
                      })
                      .finally(() => setRevealing(false));
                  }}
                  className="border-border hover:bg-accent-hover text-foreground h-8 rounded-full border px-3.5 text-xs font-medium disabled:opacity-50"
                >
                  {revealing ? "Revealing..." : "Reveal command secret"}
                </button>
                {secret ? (
                  <input
                    type="text"
                    readOnly
                    value={secret}
                    aria-label="Command secret"
                    onFocus={(event) => event.currentTarget.select()}
                    className="border-border bg-surface text-foreground h-8 min-w-0 flex-1 rounded-md border px-3 font-mono text-xs"
                  />
                ) : (
                  <span className="text-dim text-[11px]">
                    Signs every command request as x-aomi-signature.
                  </span>
                )}
              </div>
            </BotCommandFields>
          </div>
          <div className="mt-6 flex items-center justify-between gap-4">
            <span className="text-dim text-xs">
              {draft.selected.length}{" "}
              {draft.selected.length === 1 ? "app" : "apps"} attached · users
              switch with /app
            </span>
            <div className="flex items-center gap-3">
              {error ? (
                <span className="text-danger text-xs">{error}</span>
              ) : null}
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setDraft(initialDraft);
                  setDraftThreadMode(bot.threadMode);
                  setCommandDraft(seed);
                  setSecret(null);
                  setError(null);
                  onCancel();
                }}
                className="border-border hover:bg-accent-hover text-foreground h-8 rounded-full border px-3.5 text-xs font-medium disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!canSave}
                onClick={() => {
                  setSaving(true);
                  setError(null);
                  onSave(
                    draft,
                    draftThreadMode,
                    commandPatch(commandDraft, seed),
                  )
                    .then(() => setSecret(null))
                    .catch((err: unknown) => {
                      setError(
                        err instanceof Error
                          ? err.message
                          : "Failed to save apps",
                      );
                    })
                    .finally(() => setSaving(false));
                }}
                className="bg-foreground text-background disabled:bg-surface-3 disabled:text-dim h-8 rounded-full px-4 text-xs font-medium disabled:cursor-not-allowed"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="border-border flex flex-wrap gap-2 border-t px-5 py-3.5">
          {mapped.map((app) => (
            <span
              key={app.applicationId}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs",
                app.isPrimary
                  ? "border-accent-selected/40 bg-accent text-accent-selected"
                  : "border-border text-dim",
              )}
            >
              {app.isPrimary ? (
                <Star className="size-3 fill-current" aria-hidden />
              ) : null}
              {app.name}
              {app.projectLabel ? (
                <span className="opacity-60">· {app.projectLabel}</span>
              ) : null}
            </span>
          ))}
          <span
            className="text-dim w-full truncate pt-1 font-mono text-[11px]"
            data-testid="bot-command-summary"
          >
            Mini App: {bot.miniAppUrl ?? "Aomi default"}
            {bot.commandEndpoint ? ` · endpoint: ${bot.commandEndpoint}` : ""}
            {(bot.commands ?? []).length
              ? ` · ${(bot.commands ?? []).map((command) => `/${command}`).join(" ")}`
              : ""}
          </span>
          {bot.platform === "telegram" ? (
            <div className="flex w-full flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                disabled={checking || removing}
                onClick={() => {
                  setChecking(true);
                  setCheckError(null);
                  fetch(API_PATHS.bff.operate.botWebhook(bot.id), {
                    method: "POST",
                  })
                    .then(async (res) => {
                      const json = (await res.json().catch(() => ({}))) as {
                        webhook?: WebhookCheck;
                        error?: string;
                      };
                      if (!res.ok || !json.webhook) {
                        throw new Error(
                          json.error ||
                            `Failed to check webhook (${res.status})`,
                        );
                      }
                      setWebhook(json.webhook);
                      onWebhookChecked();
                    })
                    .catch((err: unknown) => {
                      setCheckError(
                        err instanceof Error
                          ? err.message
                          : "Failed to check webhook",
                      );
                    })
                    .finally(() => setChecking(false));
                }}
                className="border-border hover:bg-accent-hover text-foreground h-7 rounded-full border px-3 text-[11px] font-medium disabled:opacity-50"
              >
                {checking ? "Checking..." : "Check webhook"}
              </button>
              {webhook ? (
                <span
                  className={cn(
                    "text-[11px]",
                    webhook.urlMatches || webhook.reasserted
                      ? "text-dim"
                      : "text-danger",
                  )}
                  data-testid="bot-webhook-status"
                >
                  {webhook.urlMatches
                    ? "Webhook OK"
                    : webhook.reasserted
                      ? "Webhook was not pointed at Aomi; re-pointed now"
                      : `Webhook is not pointed at Aomi and could not be re-pointed: ${webhook.warning ?? "unknown error"}`}
                  {` · ${webhook.pendingUpdateCount} pending update${webhook.pendingUpdateCount === 1 ? "" : "s"}`}
                  {webhook.lastErrorMessage
                    ? ` · last Telegram error: ${webhook.lastErrorMessage}`
                    : ""}
                </span>
              ) : warning ? (
                <span className="text-warning text-[11px]">
                  Saved, but the webhook was not re-asserted: {warning}
                </span>
              ) : null}
              {checkError ? (
                <span className="text-danger text-[11px]">{checkError}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ── add flow ────────────────────────────────────────────────────────────────

function AddBotCard({
  options,
  onCancel,
  onRegister,
}: {
  options: AppOption[];
  onCancel: () => void;
  onRegister: (input: {
    label: string;
    token: string;
    threadMode: string;
    draft: Draft;
    commandConfig: ReturnType<typeof commandPatch>;
  }) => Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [token, setToken] = useState("");
  const [threadMode, setThreadMode] = useState("single");
  const [draft, setDraft] = useState<Draft>({ selected: [], primary: null });
  const [commandDraft, setCommandDraft] = useState<CommandDraft>(commandSeed());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canRegister =
    !busy &&
    token.trim().length > 0 &&
    draft.selected.length > 0 &&
    draft.primary !== null &&
    (commandList(commandDraft.commands).length === 0 ||
      commandDraft.commandEndpoint.trim().length > 0);

  return (
    <div className="border-border-hover bg-surface-1 rounded-md border">
      <div className="border-border border-b p-5">
        <h2 className="text-foreground text-sm font-medium">
          Add a Telegram bot
        </h2>
        <p className="text-dim mt-1 text-xs">
          Paste the token from BotFather and pick the apps this bot serves.
        </p>
      </div>
      <div className="space-y-5 p-5">
        <div className="grid gap-5 md:grid-cols-2">
          <label className="block space-y-2 text-xs">
            <span className="text-dim block text-[13px]">Bot token</span>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste BotFather token"
              disabled={busy}
              className="border-border bg-surface text-foreground h-9 w-full rounded-md border px-3 text-xs"
            />
          </label>
          <label className="block space-y-2 text-xs">
            <span className="text-dim block text-[13px]">Label (optional)</span>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Trading assistant"
              disabled={busy}
              className="border-border bg-surface text-foreground h-9 w-full rounded-md border px-3 text-xs"
            />
          </label>
        </div>
        <BotCommandFields
          draft={commandDraft}
          onChange={setCommandDraft}
          disabled={busy}
        />
        <div className="space-y-3">
          <div className="flex justify-end">
            <ThreadModeControl
              value={threadMode}
              onChange={setThreadMode}
              disabled={busy}
            />
          </div>
          <AppTable
            options={options}
            draft={draft}
            onChange={setDraft}
            disabled={busy}
          />
        </div>

        <div className="flex items-center justify-end gap-3">
          {error ? <span className="text-danger text-xs">{error}</span> : null}
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="border-border hover:bg-accent-hover text-foreground h-8 rounded-full border px-3.5 text-xs font-medium disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canRegister}
            onClick={() => {
              setBusy(true);
              setError(null);
              onRegister({
                label: label.trim(),
                token,
                threadMode,
                draft,
                // Against an empty seed: only filled fields are sent.
                commandConfig: commandPatch(commandDraft, commandSeed()),
              })
                .catch((err: unknown) => {
                  setError(
                    err instanceof Error
                      ? err.message
                      : "Failed to register bot",
                  );
                })
                .finally(() => setBusy(false));
            }}
            className="bg-foreground text-background disabled:bg-surface-3 disabled:text-dim h-8 rounded-full px-4 text-xs font-medium disabled:cursor-not-allowed"
          >
            {busy ? "Registering..." : "Register bot"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── view ────────────────────────────────────────────────────────────────────

export function BotsView() {
  const { account } = useGitHubSession();
  const queryClient = useQueryClient();
  const accountKey = githubAccountKey(account.githubLogin);
  const queryKey = buildQueryKeys.bots(accountKey ?? "unavailable");
  const botsQuery = useQuery({
    queryKey,
    queryFn: () => operateFetch<BotsPayload>("bots"),
    enabled: account.signedIn && accountKey !== null,
    staleTime: buildQueryStaleTime.operate,
  });
  const payload = botsQuery.data ?? null;
  const loading = botsQuery.isPending;
  const queryError =
    botsQuery.error && !botsQuery.data
      ? botsQuery.error instanceof Error
        ? botsQuery.error.message
        : String(botsQuery.error)
      : null;

  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  // Webhook warnings from the last save, per bot: the card that saved is
  // remounted on its new configuration version, so the note lives here.
  const [webhookWarnings, setWebhookWarnings] = useState<
    Record<string, string>
  >({});

  const projects = useMemo(() => payload?.projects ?? [], [payload?.projects]);
  const bots = useMemo(() => payload?.bots ?? [], [payload?.bots]);

  const options = useMemo<AppOption[]>(
    () =>
      projects.flatMap((project) =>
        (project.apps ?? [])
          .filter((app) => app.isActive)
          .map((app) => ({
            applicationId: app.id,
            name: app.name,
            projectLabel: projectLabel(project),
          })),
      ),
    [projects],
  );

  const handleRegister = useCallback(
    async (input: {
      label: string;
      token: string;
      threadMode: string;
      draft: Draft;
      commandConfig: ReturnType<typeof commandPatch>;
    }) => {
      const res = await fetch(botsUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credential: input.token.trim(),
          label: input.label || undefined,
          threadMode: input.threadMode,
          applicationIds: input.draft.selected,
          handoverApplicationId: input.draft.primary,
          ...input.commandConfig,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        bot?: Bot;
        error?: string;
      };
      if (!res.ok || !json.bot) {
        throw new Error(json.error || `Failed to register bot (${res.status})`);
      }
      const created = json.bot;
      queryClient.setQueryData<BotsPayload>(queryKey, (current) => ({
        projects: current?.projects ?? projects,
        bots: [created, ...(current?.bots ?? [])],
      }));
      setAdding(false);
    },
    [queryClient, queryKey, projects],
  );

  const handleSaveApps = useCallback(
    async (
      bot: Bot,
      draft: Draft,
      threadMode: string,
      commandConfig: ReturnType<typeof commandPatch>,
    ) => {
      const res = await fetch(botsUrl(), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botId: bot.id,
          applicationIds: draft.selected,
          handoverApplicationId: draft.primary,
          threadMode,
          ...commandConfig,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        bot?: Bot;
        webhookWarning?: string;
        error?: string;
      };
      if (!res.ok || !json.bot) {
        throw new Error(json.error || `Failed to save apps (${res.status})`);
      }
      const updated = json.bot;
      const webhookWarning = json.webhookWarning;
      setWebhookWarnings((current) => {
        const { [updated.id]: _cleared, ...rest } = current;
        return webhookWarning
          ? { ...rest, [updated.id]: webhookWarning }
          : rest;
      });
      queryClient.setQueryData<BotsPayload>(queryKey, (current) => ({
        projects: current?.projects ?? projects,
        bots: (current?.bots ?? []).map((b) =>
          b.id === updated.id ? updated : b,
        ),
      }));
      setEditingId(null);
    },
    [queryClient, queryKey, projects],
  );

  const handleRemove = useCallback(
    async (bot: Bot) => {
      setRemovingId(bot.id);
      setRemoveError(null);
      try {
        const res = await fetch(botsUrl({ botId: bot.id }), {
          method: "DELETE",
        });
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
        };
        if (!res.ok) {
          throw new Error(json.error || `Failed to remove bot (${res.status})`);
        }
        queryClient.setQueryData<BotsPayload>(queryKey, (current) =>
          current
            ? {
                ...current,
                bots: (current.bots ?? []).filter((b) => b.id !== bot.id),
              }
            : current,
        );
        if (editingId === bot.id) setEditingId(null);
      } catch (err) {
        setRemoveError(
          err instanceof Error ? err.message : "Failed to remove bot",
        );
      } finally {
        setRemovingId(null);
      }
    },
    [editingId, queryClient, queryKey],
  );

  if (account.loading) {
    return <LoadingPanel label="Checking GitHub session..." />;
  }

  if (!account.signedIn) {
    return <GitHubSignInPanel error={null} />;
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <ProviderRail
        botCount={bots.length}
        addOpen={adding}
        onAdd={() => setAdding(true)}
      />

      <TelegramHowItWorks />

      {removeError ? (
        <div className="border-danger/30 bg-danger/5 text-danger rounded-md border px-3 py-2 text-sm">
          {removeError}
        </div>
      ) : null}

      {adding ? (
        <AddBotCard
          options={options}
          onCancel={() => setAdding(false)}
          onRegister={handleRegister}
        />
      ) : null}

      {loading ? (
        <div className="border-border bg-surface-1 text-dim rounded-md border px-4 py-14 text-center text-sm">
          Loading bots...
        </div>
      ) : queryError ? (
        <div className="border-danger/30 bg-danger/5 text-danger rounded-md border px-4 py-3 text-sm">
          {queryError}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {bots.map((bot) => (
            // Keyed on the configuration version so a bot refreshed from the
            // server (another admin's save, or our own) remounts the card
            // with fresh seeds. Drafts are only ever compared against the
            // seed they were taken from, so a stale draft can never restore
            // an older config during an unrelated save.
            <BotCard
              key={`${bot.id}:${bot.configurationVersion ?? 0}`}
              bot={bot}
              options={options}
              editing={editingId === bot.id}
              onBeginEdit={() => setEditingId(bot.id)}
              onCancel={() => setEditingId(null)}
              onSave={(draft, threadMode, commandConfig) =>
                handleSaveApps(bot, draft, threadMode, commandConfig)
              }
              onRemove={() => void handleRemove(bot)}
              removing={removingId === bot.id}
              warning={webhookWarnings[bot.id] ?? null}
              onWebhookChecked={() =>
                setWebhookWarnings(({ [bot.id]: _checked, ...rest }) => rest)
              }
            />
          ))}
          {bots.length === 0 && !adding ? (
            <div className="border-border bg-surface-1 text-dim rounded-md border px-4 py-14 text-center text-sm">
              No Telegram bots yet. Add one to start receiving messages.
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
