import type { ReactNode } from "react";

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
  children: ReactNode;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 sm:gap-4 ${leading ? "min-h-12 py-3" : "py-3.5 sm:py-4"} ${className}`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {leading}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="truncate text-sm font-medium leading-none">
            {title}
          </div>
          <span
            className={`text-aomi-muted truncate text-[13px] leading-snug ${descMono ? "font-mono" : ""}`}
          >
            {desc}
          </span>
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function Divider() {
  return <div className="bg-aomi-border h-px" />;
}
