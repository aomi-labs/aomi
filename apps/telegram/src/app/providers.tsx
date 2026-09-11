"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PrivyProvider } from "@privy-io/react-auth";

import { privyAppId } from "./config";

export function Providers({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [queryClient] = useState(() => new QueryClient());

  // `PrivyProvider` throws on an empty app id, which would take down the
  // prerender as well as any deployment missing the variable. Failing to a
  // readable message beats a blank screen, and it keeps the build honest about
  // an env that is inlined at build time.
  if (!privyAppId) {
    return (
      <main className="wallet-page">
        <section className="wallet-control">
          <p>Wallet provider is not configured.</p>
        </section>
      </main>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <PrivyProvider
        appId={privyAppId}
        config={{
          // Telegram is proven by Aomi's server and synchronized through
          // Custom JWT. Email OTP is only the explicit recovery/link path for
          // an existing Privy wallet, never an implicit replacement identity.
          loginMethods: ["email"],
          // Hosted signing needs a wallet to exist before the exchange runs;
          // Privy provisions one during login rather than as a separate step.
          embeddedWallets: {
            ethereum: { createOnLogin: "users-without-wallets" },
          },
        }}
      >
        {children}
      </PrivyProvider>
    </QueryClientProvider>
  );
}
