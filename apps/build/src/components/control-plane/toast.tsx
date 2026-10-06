"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/lib/class-names";

export type ToastTone = "success" | "error" | "info";

export type ToastInput = {
  title: string;
  description?: string;
  tone?: ToastTone;
  durationMs?: number;
};

type ToastItem = ToastInput & { id: number };

type ToastContextValue = {
  toast: (input: ToastInput) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback((input: ToastInput) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    const item: ToastItem = {
      id,
      tone: "info",
      durationMs: 3200,
      ...input,
    };
    setItems((current) => [...current.slice(-3), item]);
  }, []);

  useEffect(() => {
    if (items.length === 0) return;
    const timers = items.map((item) =>
      window.setTimeout(() => dismiss(item.id), item.durationMs ?? 3200),
    );
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [items, dismiss]);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(100vw-2rem,22rem)] flex-col gap-2"
        aria-live="polite"
      >
        {items.map((item) => (
          <div
            key={item.id}
            role="status"
            className={cn(
              "pointer-events-auto rounded-md border px-3 py-2 text-sm shadow-lg",
              item.tone === "success" &&
                "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
              item.tone === "error" &&
                "border-destructive/30 bg-destructive/10 text-destructive",
              item.tone === "info" &&
                "border-border bg-surface-2 text-foreground",
            )}
          >
            <div className="font-medium">{item.title}</div>
            {item.description ? (
              <div className="mt-0.5 text-xs opacity-80">{item.description}</div>
            ) : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}
