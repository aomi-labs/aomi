"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid } from "lucide-react";

import { cn } from "@/lib/class-names";

import {
  settingsSections,
  settingsStatusLabel,
  type SettingsSection,
} from "./settings-data";

function StatusBadge({ status }: { status: SettingsSection["status"] }) {
  return (
    <span className="border-border text-dim shrink-0 rounded-sm border px-1 py-0.5 text-[9px] uppercase tracking-wide">
      {settingsStatusLabel(status)}
    </span>
  );
}

export function SettingsNav() {
  const pathname = usePathname();
  const isOverview = pathname === "/settings";

  return (
    <nav className="space-y-0.5" aria-label="Settings sections">
      <div className="mb-3 px-2.5">
        <p className="text-dim text-[12px] uppercase tracking-wide">Account</p>
      </div>

      <Link
        href="/settings"
        prefetch={false}
        className={cn("interactive-item w-full")}
        data-active={isOverview ? "true" : undefined}
        aria-current={isOverview ? "page" : undefined}
      >
        <LayoutGrid className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">Overview</span>
      </Link>

      {settingsSections.map((section) => {
        const href = `/settings/${section.slug}`;
        const active = pathname === href;
        const Icon = section.icon;

        return (
          <Link
            key={section.slug}
            href={href}
            prefetch={false}
            className={cn(
              "interactive-item w-full",
              section.status === "soon" && "opacity-80",
            )}
            data-active={active ? "true" : undefined}
            aria-current={active ? "page" : undefined}
          >
            <Icon className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{section.title}</span>
            <StatusBadge status={section.status} />
          </Link>
        );
      })}
    </nav>
  );
}
