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
          // Inside a Mini App the only identity Telegram can vouch for is the
          // Telegram account itself, and the bot has already proven it through
          // `initData`. Offering other methods would let the two identities
          // diverge for no gain.
          loginMethods: ["telegram"],
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
