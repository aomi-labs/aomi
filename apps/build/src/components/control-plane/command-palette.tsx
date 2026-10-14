"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FolderKanban,
  Gauge,
  Home,
  KeyRound,
  Plug,
  Plus,
  Rocket,
  Settings,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import {
  lastEnvironmentHref,
  lastProjectHref,
  lastUsageHref,
} from "@/lib/deep-links";
import { getLastProjectId } from "@/lib/last-project";
import { platformHref } from "@/features/deploy/platform";
import { usePlatform } from "@/features/deploy/use-platform";

type CommandItem = {
  id: string;
  label: string;
  hint: string;
  href: string;
  icon: LucideIcon;
  keywords?: string;
};

function buildCommands(): CommandItem[] {
  const lastId = getLastProjectId();
  const items: CommandItem[] = [
    {
      id: "project-home",
      label: lastId ? "Last project" : "Projects",
      hint: lastId ? "Open project Home" : "Your connected repositories",
      href: lastProjectHref(),
      icon: FolderKanban,
      keywords: "project app repo home",
    },
  ];

  if (lastId) {
    items.push({
      id: "projects",
      label: "All projects",
      hint: "Your connected repositories",
      href: "/projects",
      icon: FolderKanban,
      keywords: "project list",
    });
    items.push({
      id: "project-deployments",
      label: "Project deployments",
      hint: "History for last project",
      href: lastProjectHref("deployments"),
      icon: Rocket,
      keywords: "release promote live history",
    });
  }

  items.push(
    {
      id: "new-app",
      label: "New app",
      hint: "Import and deploy from GitHub",
      href: "/operate/deployments/new",
      icon: Plus,
      keywords: "create deploy import",
    },
    {
      id: "deployments",
      label: "Deployments",
      hint: "Operate → Deployments",
      href: "/operate/deployments",
      icon: Rocket,
      keywords: "release promote live",
    },
    {
      id: "transactions",
      label: "Transactions",
      hint: "Operate → Transactions",
      href: "/operate/transactions",
      icon: WalletCards,
      keywords: "tx spend",
    },
    {
      id: "usage",
      label: "Usage",
      hint: lastId ? "Credits for last project" : "Credits and tokens meter",
      href: lastUsageHref(),
      icon: Gauge,
      keywords: "credits tokens meter",
    },
    {
      id: "settings",
      label: "Settings",
      hint: "Account settings",
      href: "/settings",
      icon: Settings,
    },
    {
      id: "providers",
      label: "Providers",
      hint: "LLM keys that fund your users",
      href: "/providers",
      icon: KeyRound,
      keywords: "model keys llm openai anthropic openrouter byok",
    },
    {
      id: "secrets",
      label: "Environment / Secrets",
      hint: lastId
        ? "Keys on last project Environment"
        : "Open Environment from Settings",
      href: lastEnvironmentHref(),
      icon: KeyRound,
      keywords: "environment keys env secrets",
    },
    {
      id: "integrations",
      label: "Integrations",
      hint: "Bots and channels",
      href: "/integrations",
      icon: Plug,
    },
    {
      id: "overview",
      label: "Overview",
      hint: "Stats and recent activity",
      href: "/overview",
      icon: Home,
      keywords: "dashboard home",
    },
  );

  return items;
}

const OPEN_EVENT = "aomi-build:open-command-palette";

export function openCommandPalette() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OPEN_EVENT));
}

function matches(item: CommandItem, query: string) {
  if (!query) return true;
  const hay = `${item.label} ${item.hint} ${item.keywords ?? ""}`.toLowerCase();
  return hay.includes(query.toLowerCase());
}

export function CommandPalette() {
  const router = useRouter();
  const platform = usePlatform();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [commands, setCommands] = useState<CommandItem[]>(() =>
    buildCommands(),
  );

  const filtered = useMemo(
    () => commands.filter((item) => matches(item, query.trim())),
    [commands, query],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Prefer event.code so layout/IME quirks don't miss "k".
      // Capture phase so we see the chord before focused inputs swallow it.
      const isK = event.code === "KeyK" || event.key.toLowerCase() === "k";
      const isPalette =
        (event.metaKey || event.ctrlKey) && isK && !event.altKey;
      if (isPalette) {
        event.preventDefault();
        event.stopPropagation();
        setOpen((value) => !value);
        return;
      }
      if (event.key === "Escape") setOpen(false);
    }
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActive(0);
      return;
    }
    // Refresh last-project targets each time the palette opens.
    setCommands(buildCommands());
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  function run(href: string) {
    setOpen(false);
    router.push(platformHref(href, platform));
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-[var(--aomi-overlay)] px-4 pt-[12vh]">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close command palette"
        onClick={() => setOpen(false)}
      />
      <div
        role="dialog"
        aria-label="Command palette"
        className="border-border bg-surface-1 relative z-10 w-full max-w-lg overflow-hidden rounded-lg border shadow-xl"
      >
        <div className="border-border border-b px-3 py-2">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((i) =>
                  Math.min(i + 1, Math.max(filtered.length - 1, 0)),
                );
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                const item = filtered[active];
                if (item) run(item.href);
              }
            }}
            placeholder="Jump to projects, deployments, settings…"
            className="text-foreground placeholder:text-dim h-9 w-full bg-transparent text-sm outline-none"
          />
        </div>
        <ul className="max-h-80 overflow-y-auto p-1" role="listbox">
          {filtered.length === 0 ? (
            <li className="text-dim px-3 py-6 text-center text-sm">
              No matches.
            </li>
          ) : (
            filtered.map((item, index) => {
              const Icon = item.icon;
              const selected = index === active;
              return (
                <li key={item.id} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(index)}
                    onClick={() => run(item.href)}
                    className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm ${
                      selected
                        ? "bg-accent-hover text-foreground"
                        : "text-foreground hover:bg-accent-hover"
                    }`}
                  >
                    <Icon className="text-dim size-4 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {item.label}
                      </span>
                      <span className="text-dim block truncate text-xs">
                        {item.hint}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
        <div className="border-border text-dim border-t px-3 py-2 text-[11px]">
          ↑↓ to move · Enter to open · Esc to close
        </div>
      </div>
    </div>
  );
}
