import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { WalletFallback } from "@/features/wallet/wallet-shell";

const WalletPage = lazy(() => import("@/features/wallet/wallet-page"));

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <ClientOnly fallback={<WalletFallback />}>
      <Suspense fallback={<WalletFallback />}>
        <WalletPage />
      </Suspense>
    </ClientOnly>
  );
}
