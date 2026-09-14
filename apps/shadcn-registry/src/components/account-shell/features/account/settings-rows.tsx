import type { ReactNode } from "react";

export const settingsPanelClass =
  "border-aomi-border bg-aomi-raised overflow-hidden rounded-xl border";

export function SettingsSectionHeading({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-3 px-0.5">
      <div className="flex min-w-0 items-baseline gap-2">
        <h3 className="truncate text-[13px] font-semibold">{title}</h3>
        {detail ? (
          <span className="text-aomi-muted truncate text-[12px]">{detail}</span>
        ) : null}
      </div>
      {action}
    </div>
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
      className={`flex items-center justify-between gap-3 sm:gap-4 ${leading ? "min-h-12 py-3" : "py-3.5 sm:py-4"} ${className}`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {leading}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="truncate text-[14px] font-medium leading-none">
            {title}
          </div>
          <span
            className={`text-aomi-muted truncate text-[12px] leading-snug ${descMono ? "font-mono" : ""}`}
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
