import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { WalletFallback } from "@/screens/wallet-shell";

const WalletPage = lazy(() => import("@/screens/wallet-page"));

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
