import { useEffect, useMemo, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import {
  Bot,
  Gauge,
  Key,
  KeyRound,
  Package,
  Plug,
  Settings,
  WalletCards,
  type LucideIcon,
} from "lucide-react";

type CommandItem = {
  id: string;
  label: string;
  hint: string;
  href: string;
  icon: LucideIcon;
  keywords?: string;
};

const COMMANDS: CommandItem[] = [
  {
    id: "packages",
    label: "Packages",
    hint: "Your packages, their releases and secrets",
    href: "/packages",
    icon: Package,
    keywords: "package release promote rollback secrets",
  },
  {
    id: "agents",
    label: "Agents",
    hint: "Your agents, their configs and channels",
    href: "/agents",
    icon: Bot,
    keywords: "agent config channel telegram",
  },
  {
    id: "keys",
    label: "Keys",
    hint: "Builder keys for the CLI and CI",
    href: "/keys",
    icon: Key,
    keywords: "builder key ci cli capabilities",
  },
  {
    id: "transactions",
    label: "Transactions",
    hint: "Activity → Transactions",
    href: "/operate/transactions",
    icon: WalletCards,
    keywords: "tx spend",
  },
  {
    id: "usage",
    label: "Usage",
    hint: "Credits and tokens meter",
    href: "/operate/usage",
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
    id: "integrations",
    label: "Integrations",
    hint: "Channels",
    href: "/integrations",
    icon: Plug,
  },
];

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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const filtered = useMemo(
    () => COMMANDS.filter((item) => matches(item, query.trim())),
    [query],
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
    }
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  function run(href: string) {
    setOpen(false);
    router.navigate({ href });
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/20 px-4 pt-[12vh]">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close command palette"
        onClick={() => setOpen(false)}
      />
      <div
        role="dialog"
        aria-label="Command palette"
        className="border-border bg-aomi-raised relative z-10 w-full max-w-lg overflow-hidden rounded-card border shadow-modal"
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
            placeholder="Jump to packages, agents, keys…"
            className="text-foreground placeholder:text-aomi-muted h-9 w-full bg-transparent text-sm outline-none"
          />
        </div>
        <ul className="max-h-80 overflow-y-auto p-1" role="listbox">
          {filtered.length === 0 ? (
            <li className="text-aomi-muted px-3 py-6 text-center text-sm">
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
                    className={`flex w-full items-center gap-3 rounded-control px-3 py-2 text-left text-sm ${
                      selected
                        ? "bg-aomi-hover text-foreground"
                        : "text-foreground hover:bg-aomi-hover"
                    }`}
                  >
                    <Icon className="text-aomi-muted size-4 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {item.label}
                      </span>
                      <span className="text-aomi-muted block truncate text-xs">
                        {item.hint}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
        <div className="border-border text-aomi-muted border-t px-3 py-2 text-[11px]">
          ↑↓ to move · Enter to open · Esc to close
        </div>
      </div>
    </div>
  );
}
