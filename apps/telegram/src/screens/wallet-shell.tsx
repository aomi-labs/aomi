import { AlertCircle, Check, Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@aomi-labs/widget/components/ui/card";
import { privyAppId } from "@/lib/config";
import type { StageState } from "@/lib/ceremony";

export type Stage = {
  key: string;
  label: string;
  detail: string | null;
  state: StageState;
};

export function StageRow({ stage }: { stage: Stage }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
        {stage.state === "active" && (
          <Loader2 className="text-muted-foreground size-4 animate-spin" />
        )}
        {stage.state === "done" && (
          <Check className="text-aomi-success size-4" />
        )}
        {stage.state === "error" && (
          <AlertCircle className="text-destructive size-4" />
        )}
        {stage.state === "pending" && (
          <span className="border-border size-2 rounded-full border" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={
            stage.state === "pending"
              ? "text-muted-foreground text-sm"
              : "text-sm font-medium"
          }
        >
          {stage.label}
        </span>
        {stage.detail && (
          <span className="text-muted-foreground block truncate font-mono text-xs">
            {stage.detail}
          </span>
        )}
      </span>
    </li>
  );
}

export function WalletConfigurationMissing() {
  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardContent className="pt-6">
          <h1 className="text-lg font-semibold tracking-tight">Aomi Wallet</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            This deployment is missing its wallet provider configuration.
            Contact the team that set up this bot.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

// The server can show the initial ceremony without claiming a Telegram launch
// or loading the browser-only wallet SDK. Verification begins after hydration.
export function WalletFallback() {
  if (!privyAppId) return <WalletConfigurationMissing />;
  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg tracking-tight">Aomi Wallet</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5">
          <p className="text-muted-foreground flex items-start gap-2 text-sm" aria-live="polite">
            <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" />
            <span>Setting up your wallet…</span>
          </p>
          <ul className="grid gap-3">
            <StageRow stage={{ key: "connect", label: "Verify Telegram", detail: null, state: "active" }} />
            <StageRow stage={{ key: "link", label: "Link your wallet", detail: null, state: "pending" }} />
            <StageRow stage={{ key: "delegate", label: "Enable server signing", detail: null, state: "pending" }} />
            <StageRow stage={{ key: "permit", label: "Authorize signing", detail: null, state: "pending" }} />
          </ul>
        </CardContent>
      </Card>
    </main>
  );
}
