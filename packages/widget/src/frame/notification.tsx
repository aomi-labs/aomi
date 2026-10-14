"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useNotification, type Notification } from "@aomi-labs/react";
import { NotificationIcon } from "@/ui/notification-icon";
import { useWidgetOverlay } from "@/ui/widget-scope";

export function NotificationToaster() {
  const { notifications, dismissNotification } = useNotification();
  const overlay = useWidgetOverlay();
  const visible = notifications.filter(
    (notification) => notification.kind !== "payment_required",
  );
  if (!overlay || !visible.length) return null;
  return createPortal(
    <section
      aria-label="Notifications"
      aria-live="polite"
      className="fixed right-4 top-[72px] z-[100] flex w-[min(352px,calc(100vw-2rem))] flex-col gap-3"
    >
      {visible.map((notification) => (
        <NotificationToast
          key={notification.id}
          notification={notification}
          dismissNotification={dismissNotification}
        />
      ))}
    </section>,
    overlay,
  );
}

function NotificationToast({
  notification,
  dismissNotification,
}: {
  notification: Notification;
  dismissNotification: (id: string) => void;
}) {
  useEffect(() => {
    const duration = notification.duration ?? 6000;
    if (!Number.isFinite(duration)) return;
    const timer = window.setTimeout(
      () => dismissNotification(notification.id),
      duration,
    );
    return () => window.clearTimeout(timer);
  }, [notification.id, notification.duration, dismissNotification]);
  return (
    <div className="border-aomi-border bg-aomi-surface text-aomi-fg group relative flex w-full min-w-0 items-start gap-2.5 rounded-xl border p-3 shadow-lg">
      <NotificationIcon type={notification.type} />
      <div className="min-w-0 flex-1 break-words pt-1 text-left">
        <div className="pr-7 text-sm font-semibold leading-5">
          {notification.title}
        </div>
        {notification.message &&
          notification.message !== notification.title && (
            <div className="text-aomi-muted mt-0.5 pr-7 text-sm leading-5">
              {notification.message}
            </div>
          )}
      </div>
      <button
        type="button"
        aria-label="Close notification"
        className="text-aomi-muted hover:bg-aomi-hover hover:text-aomi-fg focus-visible:ring-aomi-accent absolute right-2.5 top-2.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-sm opacity-70 transition-colors focus-visible:outline-none focus-visible:ring-2 group-hover:opacity-100"
        onClick={() => {
          dismissNotification(notification.id);
        }}
      >
        ×
      </button>
    </div>
  );
}
