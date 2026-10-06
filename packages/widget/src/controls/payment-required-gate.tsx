"use client";

import { useCallback, useMemo, useState } from "react";
import { useControl, useNotification } from "@aomi-labs/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const PROVIDERS = [
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "openrouter", label: "OpenRouter" },
] as const;

type ProviderId = (typeof PROVIDERS)[number]["id"];

export function PaymentRequiredGate() {
  const { notifications, dismissNotification, showNotification } =
    useNotification();
  const { setByok, setInferenceFunding } = useControl();
  const paymentNotification = notifications.find(
    (notification) => notification.kind === "payment_required",
  );

  const [selectedProvider, setSelectedProvider] =
    useState<ProviderId>("openai");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = useMemo(
    () => !saving && apiKey.trim().length > 0,
    [apiKey, saving],
  );

  const handleDismiss = useCallback(() => {
    if (paymentNotification) {
      dismissNotification(paymentNotification.id);
    }
    setError(null);
  }, [dismissNotification, paymentNotification]);

  const handleSave = useCallback(async () => {
    if (!canSave) return;

    setSaving(true);
    setError(null);
    try {
      await setByok(selectedProvider, apiKey.trim(), label.trim() || undefined);
      setInferenceFunding("user_byok");
      setApiKey("");
      setLabel("");
      handleDismiss();
      // Failed user message stays in the thread with `aomiSendStatus: failed`.
      // We don't auto-retry (could be unexpected if the user moved on), but
      // we do tell them the gate is cleared so the modal isn't silently gone.
      showNotification({
        type: "success",
        title:
          "Provider key saved — resend your message to continue with BYOK.",
        duration: 6000,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save BYOK key");
    } finally {
      setSaving(false);
    }
  }, [
    apiKey,
    canSave,
    handleDismiss,
    label,
    selectedProvider,
    setInferenceFunding,
    setByok,
    showNotification,
  ]);

  if (!paymentNotification) return null;

  return (
    <div
      className="bg-background/85 absolute inset-0 z-40 flex items-center justify-center px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="payment-required-title"
    >
      <div className="bg-card border-input w-full max-w-lg rounded-3xl border p-7 shadow-2xl md:p-8">
        <div className="space-y-3">
          <h2
            id="payment-required-title"
            className="text-foreground text-2xl font-semibold tracking-normal"
          >
            Set up BYOK
          </h2>
          <p className="text-muted-foreground text-base leading-7">
            You&apos;re out of Aomi credits. Add an LLM provider key to keep
            chatting with BYOK. x402 and MPP payments are coming to the
            platform.
          </p>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {PROVIDERS.map((provider) => {
            const active = selectedProvider === provider.id;
            return (
              <button
                key={provider.id}
                type="button"
                onClick={() => setSelectedProvider(provider.id)}
                className={[
                  "rounded-full border px-5 py-2 text-sm font-medium transition-colors",
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background text-foreground hover:border-foreground/40",
                ].join(" ")}
              >
                {provider.label}
              </button>
            );
          })}
        </div>

        <div className="mt-6 grid gap-4">
          <Input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Label (optional)"
            className="h-12 rounded-full px-5 text-base shadow-inner"
          />
          <Input
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="Paste LLM provider key"
            type="password"
            autoComplete="off"
            className="h-12 rounded-full px-5 text-base shadow-inner"
          />
        </div>

        <p className="text-muted-foreground mt-4 text-sm leading-6">
          Keys are stored securely on your account. BYOK usage is recorded, but
          it does not consume Aomi credits.
        </p>

        {error && <p className="text-destructive mt-3 text-sm">{error}</p>}

        <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
          <button
            type="button"
            onClick={handleDismiss}
            className="text-foreground hover:text-muted-foreground h-11 px-4 text-sm font-medium transition-colors"
          >
            Not now
          </button>
          <Button
            type="button"
            onClick={() => {
              void handleSave();
            }}
            disabled={!canSave}
            className="h-11 rounded-full px-7"
          >
            {saving ? "Saving..." : "Save and use BYOK"}
          </Button>
        </div>
      </div>
    </div>
  );
}
