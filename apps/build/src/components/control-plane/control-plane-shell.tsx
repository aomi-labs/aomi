"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BookOpen,
  CircleUserRound,
  Github,
  FolderKanban,
  Gauge,
  Hammer,
  Home,
  KeyRound,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Rocket,
  ScrollText,
  Search,
  Settings,
  WalletCards,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { AomiLogo } from "@build/components/brand/aomi-logo";
import { ColorThemeToggle } from "@build/components/control-plane/color-theme-toggle";
import { ControlPlaneLink } from "@build/components/control-plane/control-plane-link";
import { platformHref } from "@build/features/launch/platform";
import { usePlatform } from "@build/features/launch/use-platform";
import {
  CommandPalette,
  openCommandPalette,
} from "@build/components/control-plane/command-palette";
import {
  GitHubSessionProvider,
  signedOutGitHubAccount,
  useGitHubSession,
  type GitHubAccountState,
} from "@build/components/control-plane/github-session-context";
import { ToastProvider } from "@build/components/control-plane/toast";
import {
  GITHUB_SIGNIN_URL,
  signOutGitHub,
} from "@build/features/launch/dashboard";
import { cn } from "@build/lib/utils";
import { ControlPlaneQueryProvider } from "./control-plane-query-provider";

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  enabled: boolean;
  requiresGitHub?: boolean;
};

type NavGroup = {
  title: string;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    title: "Overview",
    items: [
      { label: "Overview", href: "/overview", icon: Home, enabled: true },
      {
        label: "Projects",
        href: "/projects",
        icon: FolderKanban,
        enabled: true,
      },
    ],
  },
  {
    title: "Build",
    items: [{ label: "Build", href: "/build", icon: Hammer, enabled: true }],
  },
  {
    title: "Operate",
    items: [
      {
        label: "Deployments",
        href: "/operate/deployments",
        icon: Rocket,
        enabled: true,
        requiresGitHub: true,
      },
      {
        label: "Transactions",
        href: "/operate/transactions",
        icon: WalletCards,
        enabled: true,
        requiresGitHub: true,
      },
      {
        label: "Observability",
        href: "/operate/observability",
        icon: Activity,
        enabled: true,
        requiresGitHub: true,
      },
      {
        label: "Usage",
        href: "/operate/usage",
        icon: Gauge,
        enabled: true,
        requiresGitHub: true,
      },
      {
        label: "Logs",
        href: "/operate/logs",
        icon: ScrollText,
        enabled: true,
        requiresGitHub: true,
      },
    ],
  },
  {
    title: "Account",
    items: [
      {
        label: "Providers",
        href: "/providers",
        icon: KeyRound,
        enabled: true,
        requiresGitHub: true,
      },
      {
        label: "Integrations",
        href: "/integrations",
        icon: Plug,
        enabled: true,
        requiresGitHub: true,
      },
      { label: "Settings", href: "/settings", icon: Settings, enabled: true },
    ],
  },
];

function IconButton({
  children,
  label,
  onClick,
  className,
}: {
  children: React.ReactNode;
  label: string;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "icon-button focus-visible:ring-ring inline-flex h-8 w-8 items-center justify-center rounded-md transition focus-visible:ring-1",
        className,
      )}
    >
      {children}
    </button>
  );
}

function githubAvatarUrl(login: string | null, explicitUrl?: string | null) {
  if (explicitUrl?.trim()) return explicitUrl.trim();
  return login
    ? `https://github.com/${encodeURIComponent(login)}.png?size=96`
    : null;
}

function githubInitials(login: string | null) {
  const normalized = login?.trim();
  if (!normalized) return "GH";
  return normalized.slice(0, 2).toUpperCase();
}

function accountLabel(account: GitHubAccountState) {
  if (account.loading) return "Loading GitHub account";
  if (!account.signedIn) return "Not signed in";
  return account.githubLogin ? `@${account.githubLogin}` : "GitHub account";
}

function Avatar({
  login,
  imageUrl,
  size = "md",
}: {
  login: string | null;
  imageUrl?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const avatar = githubAvatarUrl(login, imageUrl);
  const sizeClass =
    size === "lg"
      ? "h-9 w-9 text-[12px]"
      : size === "sm"
        ? "h-7 w-7 text-[11px]"
        : "h-8 w-8 text-[11px]";
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [avatar]);

  if (avatar && !failed) {
    return (
      <img
        key={avatar}
        src={avatar}
        alt=""
        onError={() => setFailed(true)}
        className={cn(
          "bg-surface-3 shrink-0 rounded-full object-cover",
          sizeClass,
        )}
      />
    );
  }

  return (
    <span
      className={cn(
        "bg-surface-3 text-foreground flex shrink-0 items-center justify-center rounded-full font-medium",
        sizeClass,
      )}
    >
      {githubInitials(login)}
    </span>
  );
}

function AccountCard({ account }: { account: GitHubAccountState }) {
  return (
    <div className="border-border bg-surface-1 flex items-center gap-2.5 rounded-lg border px-3 py-2">
      {account.signedIn ? (
        <Avatar
          login={account.githubLogin}
          imageUrl={account.githubAvatarUrl}
          size="sm"
        />
      ) : (
        <span className="bg-surface-3 text-foreground flex h-7 w-7 shrink-0 items-center justify-center rounded-full">
          <Github className="size-3.5" />
        </span>
      )}
      <div className="min-w-0">
        <p className="text-foreground truncate text-[13px]">
          {accountLabel(account)}
        </p>
        <p className="text-dim truncate text-[11px]">
          {account.signedIn ? "GitHub account" : "Sign in with GitHub"}
        </p>
      </div>
    </div>
  );
}

function isActivePath(pathname: string, href: string) {
  return href === "/"
    ? pathname === "/"
    : pathname === href || pathname.startsWith(`${href}/`);
}

function NavItemLink({
  item,
  active,
  expanded,
  signedIn,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  expanded: boolean;
  signedIn: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const platform = usePlatform();
  const enabled = item.enabled && (!item.requiresGitHub || signedIn);
  const content = (
    <>
      <Icon className="nav-icon size-4 shrink-0" />
      {expanded ? (
        <>
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {!enabled ? (
            <span className="border-border text-dim rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
              {item.requiresGitHub ? "Sign in" : "Soon"}
            </span>
          ) : null}
        </>
      ) : null}
    </>
  );

  if (!enabled) {
    return (
      <div
        className="nav-link cursor-not-allowed opacity-65"
        title={
          !expanded
            ? item.requiresGitHub
              ? `${item.label} - sign in`
              : `${item.label} - soon`
            : undefined
        }
        aria-disabled="true"
      >
        {content}
      </div>
    );
  }

  return (
    <ControlPlaneLink
      href={platformHref(item.href, platform)}
      warmOnIntent={!active}
      onClick={onNavigate}
      data-active={active ? "true" : "false"}
      className="nav-link"
      title={!expanded ? item.label : undefined}
    >
      {content}
    </ControlPlaneLink>
  );
}

function NavGroupList({
  group,
  expanded,
  pathname,
  signedIn,
  onNavigate,
}: {
  group: NavGroup;
  expanded: boolean;
  pathname: string;
  signedIn: boolean;
  onNavigate?: () => void;
}) {
  return (
    <div className="mb-1">
      {expanded ? (
        <div className="text-subtle px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wide">
          {group.title}
        </div>
      ) : null}
      <div className="space-y-0.5 px-1">
        {group.items.map((item) => (
          <NavItemLink
            key={item.href}
            item={item}
            active={isActivePath(pathname, item.href)}
            expanded={expanded}
            signedIn={signedIn}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </div>
  );
}

function SidebarNav({
  expanded,
  pathname,
  account,
  onNavigate,
}: {
  expanded: boolean;
  pathname: string;
  account: GitHubAccountState;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto pb-3">
      {navGroups.map((group) => (
        <NavGroupList
          key={group.title}
          group={group}
          expanded={expanded}
          pathname={pathname}
          signedIn={account.loading || account.signedIn}
          onNavigate={onNavigate}
        />
      ))}

      {expanded ? (
        <div className="mt-auto px-2 pt-4">
          <AccountCard account={account} />
        </div>
      ) : null}
    </nav>
  );
}

function TopBarMenu({
  label,
  children,
  trigger,
}: {
  label: string;
  children: React.ReactNode;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={label}
        aria-expanded={open}
        className="icon-button focus-visible:ring-ring relative inline-flex h-8 w-8 items-center justify-center rounded-full transition focus-visible:ring-1"
      >
        {trigger}
      </button>
      {open ? (
        <div className="border-border bg-surface-2 text-subtle absolute right-0 top-10 z-50 w-72 overflow-hidden rounded-md border p-1 shadow-lg">
          {children}
        </div>
      ) : null}
    </div>
  );
}

function AccountMenu({
  account,
  onSignedOut,
}: {
  account: GitHubAccountState;
  onSignedOut: () => void;
}) {
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOutGitHub();
      onSignedOut();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <TopBarMenu
        label="Account menu"
        trigger={
          account.signedIn ? (
            <Avatar
              login={account.githubLogin}
              imageUrl={account.githubAvatarUrl}
              size="sm"
            />
          ) : (
            <CircleUserRound className="size-4" />
          )
        }
      >
        <div className="flex items-center gap-2.5 px-2 py-2">
          <Avatar
            login={account.githubLogin}
            imageUrl={account.githubAvatarUrl}
            size="lg"
          />
          <div className="min-w-0">
            <p className="text-foreground truncate text-[13px] font-medium">
              {accountLabel(account)}
            </p>
            <p className="text-dim truncate text-[11px]">
              {account.signedIn ? "GitHub account" : "No active GitHub session"}
            </p>
          </div>
        </div>
        <div className="bg-border -mx-1 my-1 h-px" />
        {account.signedIn && account.githubLogin ? (
          <a
            href={`https://github.com/${encodeURIComponent(account.githubLogin)}`}
            target="_blank"
            rel="noreferrer"
            className="hover:bg-accent-hover hover:text-foreground flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition"
          >
            <Github className="size-3.5" />
            GitHub profile
          </a>
        ) : (
          <a
            href={GITHUB_SIGNIN_URL}
            className="hover:bg-accent-hover hover:text-foreground flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition"
          >
            <Github className="size-3.5" />
            Sign in with GitHub
          </a>
        )}
        <Link
          href="/settings"
          prefetch={false}
          className="hover:bg-accent-hover hover:text-foreground flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition"
        >
          <Settings className="size-3.5" />
          Settings
        </Link>
        <div className="bg-border -mx-1 my-1 h-px" />
        <a
          href="https://aomi.dev/docs"
          target="_blank"
          rel="noreferrer"
          className="hover:bg-accent-hover hover:text-foreground flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition"
        >
          <BookOpen className="size-3.5" />
          Docs
        </a>
        <a
          href="https://aomi.dev"
          target="_blank"
          rel="noreferrer"
          className="hover:bg-accent-hover hover:text-foreground flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition"
        >
          <Home className="size-3.5" />
          Home page
        </a>
        <div className="bg-border -mx-1 my-1 h-px" />
        <button
          type="button"
          onClick={handleSignOut}
          disabled={!account.signedIn || signingOut}
          className="hover:bg-accent-hover hover:text-foreground flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-50"
        >
          <LogOut className="size-3.5" />
          {signingOut ? "Signing out" : "Sign out"}
        </button>
      </TopBarMenu>
    </div>
  );
}

export function ControlPlaneShell({ children }: { children: React.ReactNode }) {
  return (
    <ControlPlaneQueryProvider>
      <GitHubSessionProvider>
        <ToastProvider>
          <ControlPlaneShellContent>{children}</ControlPlaneShellContent>
        </ToastProvider>
      </GitHubSessionProvider>
    </ControlPlaneQueryProvider>
  );
}

function ControlPlaneShellContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { account, setAccount } = useGitHubSession();
  const queryClient = useQueryClient();

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <div className="bg-background text-foreground grid h-screen min-h-0 grid-cols-1 lg:grid-cols-[auto_minmax(0,1fr)]">
      <aside
        className={cn(
          "border-border bg-sidebar hidden min-h-0 flex-col border-r transition-all duration-200 lg:flex",
          expanded ? "w-56" : "w-14",
        )}
      >
        <div
          className={cn(
            "border-border relative shrink-0 border-b",
            expanded && "h-11",
          )}
        >
          <div
            className={cn(
              "flex items-center gap-2 px-3",
              expanded ? "h-full justify-between" : "h-11 justify-center px-2",
            )}
          >
            <AomiLogo
              href="/"
              markOnly={!expanded}
              showBuildLabel={expanded}
              className={cn(expanded && "min-w-0 flex-1")}
            />
            {expanded ? (
              <IconButton
                label="Collapse sidebar"
                onClick={() => setExpanded(false)}
                className="shrink-0"
              >
                <PanelLeftClose className="size-4" />
              </IconButton>
            ) : null}
          </div>
          {!expanded ? (
            <div className="flex justify-center pb-2">
              <IconButton
                label="Expand sidebar"
                onClick={() => setExpanded(true)}
                className="h-7 w-7"
              >
                <PanelLeftOpen className="size-3.5" />
              </IconButton>
            </div>
          ) : null}
        </div>

        <SidebarNav expanded={expanded} pathname={pathname} account={account} />
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="h-full flex-1 bg-[var(--aomi-overlay)]"
            aria-label="Close sidebar"
          />
          <aside className="border-border bg-sidebar flex h-full w-72 flex-col border-l">
            <div className="border-border flex h-11 items-center justify-between gap-3 border-b px-3">
              <AomiLogo
                href="/"
                className="min-w-0 flex-1"
                onClick={() => setMobileOpen(false)}
              />
              <IconButton
                label="Close menu"
                onClick={() => setMobileOpen(false)}
              >
                <X className="size-4" />
              </IconButton>
            </div>
            <SidebarNav
              expanded
              pathname={pathname}
              account={account}
              onNavigate={() => setMobileOpen(false)}
            />
          </aside>
        </div>
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-col">
        <header className="border-border flex h-11 shrink-0 items-center justify-between border-b px-4">
          <IconButton
            label="Open menu"
            onClick={() => setMobileOpen(true)}
            className="lg:hidden"
          >
            <Menu className="size-4" />
          </IconButton>
          <div className="hidden lg:block" />
          <div className="flex items-center gap-2">
            {/* Desktop-first: full Search · ⌘K on sm+. Phone: icon only (usable, not designed for). */}
            <button
              type="button"
              onClick={() => openCommandPalette()}
              className="icon-button border-border inline-flex h-8 items-center gap-2 rounded-md border px-2 text-xs"
              aria-label="Open command palette (⌘K)"
              title="Search (⌘K)"
            >
              <Search className="size-3.5 shrink-0" aria-hidden />
              <span className="hidden sm:inline">Search</span>
              <kbd className="border-border hidden rounded border px-1 py-0.5 text-[10px] sm:inline">
                ⌘K
              </kbd>
            </button>
            <ColorThemeToggle />
            <AccountMenu
              account={account}
              onSignedOut={() => {
                queryClient.clear();
                setAccount(signedOutGitHubAccount());
              }}
            />
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
        <CommandPalette />
      </div>
    </div>
  );
}
