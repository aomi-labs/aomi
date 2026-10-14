"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

// =============================================================================
// Types
// =============================================================================

export type NotificationType = "notice" | "success" | "error" | "wallet";

export type Notification = {
  id: string;
  type: NotificationType;
  /**
   * Optional discriminator for notifications that have a bespoke UI consumer.
   *
   * - `payment_required` is consumed by `PaymentRequiredGate` (packages/widget)
   *   as a blocking modal. The toaster skips this kind. As a result, `type`,
   *   `message`, and `duration` are NOT rendered for this kind — only `kind`
   *   matters for routing. Don't bother passing those fields when firing it.
   */
  kind?: "payment_required";
  title: string;
  message?: string;
  duration?: number;
  timestamp: number;
};

export type NotificationData = Omit<Notification, "id" | "timestamp">;

export type NotificationContextApi = {
  /** All active notifications */
  notifications: Notification[];
  /** Show a new notification */
  showNotification: (params: NotificationData) => string;
  /** Dismiss a notification by ID */
  dismissNotification: (id: string) => void;
  /** Clear all notifications */
  clearAll: () => void;
};

// =============================================================================
// Context
// =============================================================================

const NotificationContext = createContext<NotificationContextApi | null>(null);

// =============================================================================
// Hook
// =============================================================================

export function useNotification(): NotificationContextApi {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error(
      "useNotification must be used within NotificationContextProvider",
    );
  }
  return context;
}

// =============================================================================
// Provider
// =============================================================================

let notificationIdCounter = 0;
function generateId(): string {
  return `notif-${Date.now()}-${++notificationIdCounter}`;
}

export type NotificationContextProviderProps = {
  children: ReactNode;
};

export function NotificationContextProvider({
  children,
}: NotificationContextProviderProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  // Tracks the active `payment_required` notification id so we can dedupe
  // synchronously (the state reducer may run async-batched, so reading
  // `notifications` inside `setNotifications` won't reliably reflect back
  // through the returned id). The UI gates a single blocking modal on this
  // kind — without dedupe each 402 stacks an entry that the modal's "Not now"
  // can only dismiss one-at-a-time. Callers can fire on every 402.
  const paymentRequiredIdRef = useRef<string | null>(null);

  const showNotification = useCallback((params: NotificationData) => {
    if (params.kind === "payment_required" && paymentRequiredIdRef.current) {
      return paymentRequiredIdRef.current;
    }
    const id = generateId();
    const notification: Notification = {
      ...params,
      id,
      timestamp: Date.now(),
    };
    if (params.kind === "payment_required") {
      paymentRequiredIdRef.current = id;
    }
    setNotifications((prev) => [notification, ...prev]);
    return id;
  }, []);

  const dismissNotification = useCallback((id: string) => {
    if (paymentRequiredIdRef.current === id) {
      paymentRequiredIdRef.current = null;
    }
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    paymentRequiredIdRef.current = null;
    setNotifications([]);
  }, []);

  const value: NotificationContextApi = {
    notifications,
    showNotification,
    dismissNotification,
    clearAll,
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}
