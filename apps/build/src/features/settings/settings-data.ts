import {
  Activity,
  Bell,
  Bot,
  CreditCard,
  KeyRound,
  Palette,
  Settings,
  ShieldAlert,
  UserRound,
  WalletCards,
  type LucideIcon,
} from "lucide-react";

export type SettingsSection = {
  slug: string;
  title: string;
  description: string;
  icon: LucideIcon;
  enabled: boolean;
  status: "available" | "project-scoped" | "soon";
  detail: string;
  actionHref?: string;
  actionLabel?: string;
};

export const settingsSections: SettingsSection[] = [
  {
    slug: "general",
    title: "General",
    description: "Profile and workspace defaults.",
    icon: UserRound,
    enabled: true,
    status: "available",
    detail: "Choose a deployment platform and review repository access.",
  },
  {
    slug: "secrets",
    title: "Secrets",
    description: "Per-project environment values.",
    icon: KeyRound,
    enabled: true,
    status: "project-scoped",
    detail: "Open a project Environment tab to edit secrets.",
  },
  {
    slug: "notifications",
    title: "Notifications",
    description: "Alert channels and thresholds.",
    icon: Bell,
    enabled: true,
    status: "soon",
    detail: "Coming soon.",
  },
  {
    slug: "appearance",
    title: "Appearance",
    description: "Theme and display.",
    icon: Palette,
    enabled: true,
    status: "soon",
    detail: "Coming soon. Build uses the dark shell theme.",
  },
  {
    slug: "integrations",
    title: "Integrations",
    description: "External bots and services.",
    icon: Settings,
    enabled: true,
    status: "soon",
    detail:
      "Credential save is coming soon. Open Account → Integrations for docs.",
    actionHref: "/integrations",
    actionLabel: "Open Integrations",
  },
  {
    slug: "billing",
    title: "Billing",
    description: "Spend and payment setup. Usage is under Operate.",
    icon: CreditCard,
    enabled: true,
    status: "available",
    detail: "Invoices are not in Build yet. See Operate → Usage for spend.",
  },
  {
    slug: "bots",
    title: "Bot setup",
    description: "Telegram and deploy bots.",
    icon: Bot,
    enabled: true,
    status: "soon",
    detail: "Coming soon.",
  },
  {
    slug: "wallets",
    title: "Wallets",
    description: "Signer and wallet connections.",
    icon: WalletCards,
    enabled: true,
    status: "soon",
    detail: "Coming soon.",
  },
  {
    slug: "observability",
    title: "Observability",
    description: "Metrics and alert exports.",
    icon: Activity,
    enabled: true,
    status: "soon",
    detail: "Coming soon.",
  },
  {
    slug: "danger",
    title: "Danger zone",
    description: "Delete or transfer this workspace.",
    icon: ShieldAlert,
    enabled: true,
    status: "soon",
    detail: "Coming soon.",
  },
];

export function settingsStatusLabel(status: SettingsSection["status"]) {
  if (status === "available") return "Available";
  if (status === "project-scoped") return "Project-scoped";
  return "Soon";
}

export function getSettingsSection(slug: string) {
  return settingsSections.find((section) => section.slug === slug);
}
