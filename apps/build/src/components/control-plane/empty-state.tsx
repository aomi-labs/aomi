import { UrlLink as Link } from "@/components/url-link";
import type { ReactNode } from "react";

import { EmptyPanel } from "@/features/deploy/components/deployments/ui/state-panels";

type EmptyStateProps = {
  title: string;
  description?: string;
  actionHref?: string;
  actionLabel?: string;
  onAction?: () => void;
  children?: ReactNode;
};

/**
 * Empty = next action. Prefer one primary CTA over a blank message.
 */
export function EmptyState({
  title,
  description,
  actionHref,
  actionLabel,
  onAction,
  children,
}: EmptyStateProps) {
  const action =
    actionHref && actionLabel ? (
      <Link
        href={actionHref}
        className="bg-primary text-primary-foreground inline-flex h-8 items-center justify-center rounded-md px-3 text-sm font-medium hover:opacity-90"
      >
        {actionLabel}
      </Link>
    ) : onAction && actionLabel ? (
      <button
        type="button"
        onClick={onAction}
        className="bg-primary text-primary-foreground inline-flex h-8 items-center justify-center rounded-md px-3 text-sm font-medium hover:opacity-90"
      >
        {actionLabel}
      </button>
    ) : null;

  return (
    <EmptyPanel>
      <div className="flex flex-col items-center gap-3">
        <div className="space-y-1">
          <p className="text-foreground text-sm font-medium">{title}</p>
          {description ? (
            <p className="text-dim max-w-sm text-xs leading-5">{description}</p>
          ) : null}
        </div>
        {children}
        {action}
      </div>
    </EmptyPanel>
  );
}
