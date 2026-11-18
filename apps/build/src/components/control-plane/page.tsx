import type { ReactNode } from "react";

/** The page frame under the top bar: 1080px column, 32px gutters, 24px gaps. */
export const pageFrame =
  "mx-auto flex w-full max-w-[1080px] flex-col gap-6 px-4 pb-16 pt-8 sm:px-8";

/** The page title: 22/28 semibold. */
export const pageTitle =
  "text-aomi-fg text-[22px] font-semibold leading-7 tracking-[-0.02em]";

/** Title (with optional pills), a muted line under it, and actions at the right. */
export function PageHeader({
  title,
  badges,
  summary,
  actions,
}: {
  title: ReactNode;
  badges?: ReactNode;
  summary?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-[1_1_480px] flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className={pageTitle}>{title}</h1>
          {badges}
        </div>
        {summary ? (
          <div className="text-aomi-muted flex flex-col gap-1 text-[14px]">
            {summary}
          </div>
        ) : null}
      </div>
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </div>
  );
}
