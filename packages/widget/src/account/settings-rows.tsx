import type { ReactNode } from "react";

import { cn } from "@aomi-labs/react";
import { ListRow, listGroupClass } from "@/ui/aomi/list-group";
import { HelpHint, SectionHeader } from "@/ui/aomi/section-header";

// Settings-era names for the shared primitives in `ui/aomi`. New code should
// import `SectionHeader`, `ListGroup` / `ListRow` and `HelpHint` directly.

export const settingsPanelClass = listGroupClass;

export const SettingsHint = HelpHint;

export function SettingsSectionHeading({
  title,
  detail,
  hint,
  action,
  className,
}: {
  title: string;
  detail?: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <SectionHeader
      title={title}
      detail={detail}
      help={hint}
      action={action}
      className={className}
    />
  );
}

/**
 * `ListRow` without its own inset: settings panels pass the horizontal
 * padding (`px-4`) themselves and separate rows with `Divider`.
 */
export function SettingRow({
  title,
  desc,
  descMono,
  leading,
  className,
  children,
}: {
  title: ReactNode;
  desc: ReactNode;
  descMono?: boolean;
  leading?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <ListRow
      title={title}
      description={desc}
      descriptionMono={descMono}
      leading={leading}
      trailing={children}
      className={cn(
        "min-h-0 px-0 sm:gap-4",
        leading ? "min-h-12 py-3" : "py-3.5 sm:py-4",
        className,
      )}
    />
  );
}

export function Divider() {
  return <div className="bg-aomi-border h-px" />;
}
