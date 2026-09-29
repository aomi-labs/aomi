import type { ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../ui/tooltip";

export const settingsPanelClass =
  "border-aomi-border bg-aomi-raised overflow-hidden rounded-xl border";

export function SettingsSectionHeading({
  title,
  detail,
  hint,
  action,
}: {
  title: string;
  detail?: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-3 px-0.5">
      <div className="flex min-w-0 items-center gap-2">
        <h3 className="truncate text-[13px] font-semibold">{title}</h3>
        {hint ? <SettingsHint label={title} text={hint} /> : null}
        {detail ? (
          <span className="text-aomi-muted truncate text-[12px]">{detail}</span>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function SettingsHint({ label, text }: { label: string; text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`About ${label}`}
          className="border-aomi-border text-aomi-muted hover:text-aomi-fg flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors"
        >
          <CircleHelp size={12} />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={6}
        className="bg-aomi-fg text-aomi-bg max-w-64 text-pretty"
      >
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

export function SettingRow({
  title,
  desc,
  descMono,
  leading,
  className = "",
  children,
}: {
  title: ReactNode;
  desc: string;
  descMono?: boolean;
  leading?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 sm:flex-nowrap sm:gap-4 ${leading ? "min-h-12 py-3" : "py-3.5 sm:py-4"} ${className}`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {leading}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="text-[14px] font-medium leading-snug [overflow-wrap:anywhere] sm:truncate sm:leading-none">
            {title}
          </div>
          <span
            className={`text-aomi-muted text-[12px] leading-snug [overflow-wrap:anywhere] sm:truncate ${descMono ? "font-mono" : ""}`}
          >
            {desc}
          </span>
        </div>
      </div>
      {children ? <div className="shrink-0">{children}</div> : null}
    </div>
  );
}

export function Divider() {
  return <div className="bg-aomi-border h-px" />;
}
