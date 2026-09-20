"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { toast } from "sonner";

import { useNotification } from "@aomi-labs/react";
import type { Notification } from "@aomi-labs/react";

import { NotificationIcon } from "./notification-icon";
import { Toaster } from "./sonner";

export function NotificationToaster() {
  const { notifications, dismissNotification } = useNotification();
  const shownRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const activeIds = new Set(
      notifications.map((notification) => notification.id),
    );
    for (const id of shownRef.current) {
      if (!activeIds.has(id)) {
        shownRef.current.delete(id);
      }
    }

    for (const notification of notifications) {
      if (notification.kind === "payment_required") continue;
      if (shownRef.current.has(notification.id)) continue;
      shownRef.current.add(notification.id);
      showToast(notification, dismissNotification);
    }
  }, [notifications, dismissNotification]);

  return (
    <Toaster
      position="top-right"
      style={{ "--width": "352px" } as CSSProperties}
      toastOptions={{
        classNames: {
          toast: "w-full !border-0 !bg-transparent !p-0 !shadow-none",
        },
      }}
      offset={{ top: 72, right: 16 }}
      mobileOffset={{ top: 68, right: 16, left: 16 }}
    />
  );
}

function showToast(
  notification: Notification,
  dismissNotification: (id: string) => void,
) {
  const options = {
    id: notification.id,
    duration: notification.duration ?? 6000,
    unstyled: true,
    onDismiss: () => dismissNotification(notification.id),
    onAutoClose: () => dismissNotification(notification.id),
  };

  toast.custom(
    () => (
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
            toast.dismiss(notification.id);
          }}
        >
          ×
        </button>
      </div>
    ),
    options,
  );
}
