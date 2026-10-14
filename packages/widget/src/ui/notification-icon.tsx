import type { NotificationType } from "@aomi-labs/react";
import type { FC } from "react";

function NoticeIcon() {
  return (
    <>
      <path d="M12 3.5v2" />
      <path d="M12 18.5v2" />
      <path d="m5.99 5.99 1.42 1.42" />
      <path d="m16.59 16.59 1.42 1.42" />
      <path d="M3.5 12h2" />
      <path d="M18.5 12h2" />
      <path d="m5.99 18.01 1.42-1.42" />
      <path d="m16.59 7.41 1.42-1.42" />
      <circle cx="12" cy="12" r="3.25" />
    </>
  );
}

function SuccessIcon() {
  return (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.25 12.25 2.4 2.4 5.1-5.3" />
    </>
  );
}

function ErrorIcon() {
  return (
    <>
      <path d="M10.35 4.5 2.9 17.4A1.4 1.4 0 0 0 4.1 19.5h15.8a1.4 1.4 0 0 0 1.2-2.1L13.65 4.5a1.9 1.9 0 0 0-3.3 0Z" />
      <path d="M12 9v4" />
      <path d="M12 16.5h.01" />
    </>
  );
}

function WalletIcon() {
  return (
    <>
      <path d="M4 7.25A2.25 2.25 0 0 1 6.25 5h10.5A2.25 2.25 0 0 1 19 7.25v10.5A2.25 2.25 0 0 1 16.75 20H6.25A2.25 2.25 0 0 1 4 17.75V7.25Z" />
      <path d="M4 8h13.75A2.25 2.25 0 0 1 20 10.25v3.5A2.25 2.25 0 0 1 17.75 16H14a3 3 0 0 1 0-6h6" />
      <circle cx="14" cy="13" r=".75" fill="currentColor" stroke="none" />
    </>
  );
}

const icons = {
  notice: NoticeIcon,
  success: SuccessIcon,
  error: ErrorIcon,
  wallet: WalletIcon,
} satisfies Record<NotificationType, FC>;

export function NotificationIcon({ type }: { type: NotificationType }) {
  const Icon = icons[type];

  return (
    <div
      className="text-aomi-accent flex size-8 shrink-0 items-center justify-center"
      data-notification-icon={type}
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <Icon />
      </svg>
    </div>
  );
}
