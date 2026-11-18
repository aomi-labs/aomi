import { cn } from "@aomi-labs/widget";
import { UrlLink as Link } from "@/components/url-link";
import { useLocation } from "@tanstack/react-router";
import {
  Activity,
  BookOpen,
  Bot,
  ChevronsUpDown,
  Gauge,
  Github,
  Home,
  Key,
  KeyRound,
  LogOut,
  Package,
  PanelLeft,
  Plug,
  ScrollText,
  Search,
  Settings,
  Sparkles,
  WalletCards,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Aomi } from "@aomi-labs/client";

import { AomiLogo } from "@/components/brand/aomi-logo";
import { ColorThemeToggle } from "@/components/control-plane/color-theme-toggle";
import { ControlPlaneLink } from "@/components/control-plane/control-plane-link";
import {
  CommandPalette,
  openCommandPalette,
} from "@/components/control-plane/command-palette";
import {
  GitHubSessionProvider,
  signedOutGitHubAccount,
  useGitHubSession,
  type GitHubAccountState,
} from "@/components/control-plane/github-session-context";
import { SignInScreen } from "@/components/control-plane/sign-in-screen";
import { ToastProvider } from "@/components/control-plane/toast";
import { githubSigninUrl, launchSignOutGitHub } from "@/features/deploy/client";

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Works without a GitHub session. */
  public?: boolean;
  /** Has pages under it, named in the top bar as `label / name`. */
  detail?: boolean;
};

type NavGroup = { title?: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  {
    items: [
      { label: "Packages", href: "/packages", icon: Package, detail: true },
      { label: "Agents", href: "/agents", icon: Bot, detail: true },
      { label: "Create with AI", href: "/build", icon: Sparkles, public: true },
    ],
  },
  {
    title: "Activity",
    items: [
      {
        label: "Transactions",
        href: "/operate/transactions",
        icon: WalletCards,
      },
      {
        label: "Health",
        href: "/operate/observability",
        icon: Activity,
        detail: true,
      },
      { label: "Usage", href: "/operate/usage", icon: Gauge },
      { label: "Logs", href: "/operate/logs", icon: ScrollText },
    ],
  },
  {
    title: "Account",
    items: [
      { label: "Keys", href: "/keys", icon: Key },
      { label: "Providers", href: "/providers", icon: KeyRound },
      { label: "Integrations", href: "/integrations", icon: Plug },
      { label: "Settings", href: "/settings", icon: Settings, public: true },
    ],
  },
];

const navItems = navGroups.flatMap((group) => group.items);

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function activeItem(pathname: string) {
  return navItems.find((item) => isActivePath(pathname, item.href));
}

function githubAvatarUrl(login: string | null, explicitUrl?: string | null) {
  if (explicitUrl?.trim()) return explicitUrl.trim();
  return login
    ? `https://github.com/${encodeURIComponent(login)}.png?size=96`
    : null;
}

function Avatar({ account }: { account: GitHubAccountState }) {
  const avatar = githubAvatarUrl(account.githubLogin, account.githubAvatarUrl);
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
        className="bg-aomi-surface-2 size-[30px] shrink-0 rounded-lg object-cover"
      />
    );
  }

  return (
    <span className="bg-aomi-surface-2 text-aomi-fg flex size-[30px] shrink-0 items-center justify-center rounded-lg">
      <Github className="size-4" aria-hidden />
    </span>
  );
}

const MENU_ITEM =
  "text-aomi-fg hover:bg-aomi-hover flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:text-aomi-muted";

/** The account card at the foot of the sidebar; it opens the account menu upward. */
function AccountCard({
  account,
  onSignedOut,
}: {
  account: GitHubAccountState;
  onSignedOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const card =
    "border-aomi-border bg-aomi-raised text-aomi-fg flex min-h-12 w-full items-center gap-2.5 rounded-xl border p-2 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)]";

  if (!account.loading && !account.signedIn) {
    return (
      <a href={githubSigninUrl} className={card}>
        <Avatar account={account} />
        <span className="flex min-w-0 flex-1 flex-col gap-[5px]">
          <span className="text-[13px] font-medium leading-none">
            Sign in with GitHub
          </span>
          <span className="text-aomi-muted text-[11.5px] leading-none">
            To see your packages and agents
          </span>
        </span>
      </a>
    );
  }

  async function signOut() {
    setSigningOut(true);
    try {
      await launchSignOutGitHub();
      onSignedOut();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Account menu"
        aria-expanded={open}
        className={card}
      >
        <Avatar account={account} />
        <span className="flex min-w-0 flex-1 flex-col gap-[5px]">
          <span className="truncate text-[13px] font-medium leading-none">
            {account.loading ? "Loading…" : (account.githubLogin ?? "GitHub")}
          </span>
          <span className="text-aomi-muted text-[11.5px] leading-none">
            Builder · GitHub
          </span>
        </span>
        <ChevronsUpDown className="text-aomi-muted size-4 shrink-0" />
      </button>
      {open ? (
        <div className="border-aomi-border bg-aomi-raised rounded-card shadow-popover absolute inset-x-0 bottom-full z-50 mb-2 flex flex-col border p-1">
          {account.githubLogin ? (
            <a
              href={`https://github.com/${encodeURIComponent(account.githubLogin)}`}
              target="_blank"
              rel="noreferrer"
              className={MENU_ITEM}
            >
              <Github />
              GitHub profile
            </a>
          ) : null}
          <Link href="/settings" preload={false} className={MENU_ITEM}>
            <Settings />
            Settings
          </Link>
          <a
            href="https://aomi.dev"
            target="_blank"
            rel="noreferrer"
            className={MENU_ITEM}
          >
            <Home />
            Home page
          </a>
          <div className="bg-aomi-border -mx-1 my-1 h-px" />
          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            className={MENU_ITEM}
          >
            <LogOut />
            {signingOut ? "Signing out" : "Sign out"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Sidebar({
  pathname,
  account,
  onSignedOut,
  onNavigate,
  closeButton,
}: {
  pathname: string;
  account: GitHubAccountState;
  onSignedOut: () => void;
  onNavigate?: () => void;
  closeButton?: React.ReactNode;
}) {
  const signedIn = account.loading || account.signedIn;
  return (
    <>
      <div className="mb-3 ml-4 mr-2 mt-4 flex items-center justify-between">
        <AomiLogo onClick={onNavigate} />
        {closeButton}
      </div>
      <nav
        aria-label="Build"
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2"
      >
        {navGroups.map((group, index) => {
          const items = group.items.filter((item) => signedIn || item.public);
          if (items.length === 0) return null;
          return (
            <div key={group.title ?? index} className="flex flex-col gap-0.5">
              {group.title ? (
                <div className="text-aomi-muted px-2 pb-2 pt-5 text-[12px] font-medium leading-4">
                  {group.title}
                </div>
              ) : null}
              {items.map((item) => {
                const active = isActivePath(pathname, item.href);
                const Icon = item.icon;
                return (
                  <ControlPlaneLink
                    key={item.href}
                    href={item.href}
                    warmOnIntent={!active}
                    onClick={onNavigate}
                    data-active={active ? "true" : "false"}
                    aria-current={active ? "page" : undefined}
                    className="nav-link"
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">
                      {item.label}
                    </span>
                  </ControlPlaneLink>
                );
              })}
            </div>
          );
        })}
      </nav>
      <div className="mx-3 mb-4 pt-4">
        <AccountCard account={account} onSignedOut={onSignedOut} />
      </div>
    </>
  );
}

/** The top bar title: the page's name, or `Section / name` under a section. */
function TopBarTitle({ pathname }: { pathname: string }) {
  const item = activeItem(pathname);
  if (!item) return null;
  const rest = pathname.slice(item.href.length + 1);
  if (!item.detail || !rest)
    return <span className="text-[14px] font-medium">{item.label}</span>;
  return (
    <span className="flex min-w-0 items-center gap-2 text-[14px]">
      <Link href={item.href} className="text-aomi-muted hover:text-aomi-fg">
        {item.label}
      </Link>
      <span className="text-aomi-muted/70">/</span>
      <span className="truncate font-medium">{decodeURIComponent(rest)}</span>
    </span>
  );
}

const TOP_BUTTON =
  "text-aomi-muted hover:bg-aomi-hover hover:text-aomi-fg rounded-control flex size-8 items-center justify-center transition-colors [&_svg]:size-[18px]";

export function ControlPlaneShell({ children }: { children: React.ReactNode }) {
  return (
    <GitHubSessionProvider>
      <ToastProvider>
        <ControlPlaneShellContent>{children}</ControlPlaneShellContent>
      </ToastProvider>
    </GitHubSessionProvider>
  );
}

function ControlPlaneShellContent({ children }: { children: React.ReactNode }) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const [expanded, setExpanded] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { account, setAccount } = useGitHubSession();
  const queryClient = useQueryClient();
  // A negative builder balance blocks deploys and activations, and pauses
  // paid chats on every live agent, so it is surfaced on every page.
  const builderDebt = useQuery({
    queryKey: ["builder-credits"],
    enabled: account.signedIn,
    staleTime: 60_000,
    retry: false,
    queryFn: () =>
      new Aomi({ baseUrl: "", guest: false }).builder.credits.get(),
    select: (balance) => balance.debt_microusd,
  }).data;

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  if (!account.loading && !account.signedIn && !activeItem(pathname)?.public)
    return <SignInScreen />;

  const onSignedOut = () => {
    queryClient.clear();
    setAccount(signedOutGitHubAccount());
  };

  return (
    <div className="bg-aomi-bg text-aomi-fg flex h-screen min-h-0">
      {expanded ? (
        <aside className="border-aomi-border bg-aomi-surface hidden w-[252px] shrink-0 flex-col border-r lg:flex">
          <Sidebar
            pathname={pathname}
            account={account}
            onSignedOut={onSignedOut}
          />
        </aside>
      ) : null}

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <aside className="border-aomi-border bg-aomi-surface flex h-full w-[252px] flex-col border-r">
            <Sidebar
              pathname={pathname}
              account={account}
              onSignedOut={onSignedOut}
              onNavigate={() => setMobileOpen(false)}
              closeButton={
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  aria-label="Close menu"
                  className={TOP_BUTTON}
                >
                  <X />
                </button>
              }
            />
          </aside>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="h-full flex-1 bg-black/20"
            aria-label="Close sidebar"
          />
        </div>
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="border-aomi-border flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-label={expanded ? "Hide sidebar" : "Show sidebar"}
            className={cn(TOP_BUTTON, "hidden size-7 lg:flex [&_svg]:size-4")}
          >
            <PanelLeft />
          </button>
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className={cn(TOP_BUTTON, "size-7 lg:hidden [&_svg]:size-4")}
          >
            <PanelLeft />
          </button>
          <TopBarTitle pathname={pathname} />
          <div className="ml-auto flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => openCommandPalette()}
              aria-label="Search (⌘K)"
              title="Search (⌘K)"
              className={TOP_BUTTON}
            >
              <Search />
            </button>
            <a
              href="https://aomi.dev/docs"
              target="_blank"
              rel="noreferrer"
              aria-label="Docs"
              title="Docs"
              className={TOP_BUTTON}
            >
              <BookOpen />
            </a>
            <ColorThemeToggle className={TOP_BUTTON} />
          </div>
        </header>
        {account.expired && (
          <div
            role="alert"
            className="border-warning/30 bg-warning/10 flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 text-sm"
          >
            <p>Session expired.</p>
            <a
              href={githubSigninUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-warning shrink-0 font-medium underline underline-offset-4"
            >
              Sign in again
            </a>
          </div>
        )}
        {builderDebt ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 border-b border-red-500/30 bg-red-500/10 px-4 py-3 text-sm"
          >
            <p>
              Your builder balance is{" "}
              {new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: "USD",
              }).format(-builderDebt / 1_000_000)}
              . Deploys are blocked and your live agents can’t answer chats
              until you add credits.
            </p>
            {pathname !== "/settings/billing" ? (
              <Link
                href="/settings/billing"
                className="shrink-0 font-medium text-red-500 underline underline-offset-4"
              >
                Add credits
              </Link>
            ) : null}
          </div>
        ) : null}
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
        <CommandPalette />
      </div>
    </div>
  );
}
