"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PrivyProvider } from "@privy-io/react-auth";

import { privyAppId } from "./config";

/** Telegram's own palette, so Privy's native modal does not arrive as a white
 *  sheet on top of a dark Mini App. Read once: the values only feed Privy's
 *  config object, never our markup, so the prerender cannot mismatch. */
function telegramAppearance(): {
  theme: "light" | "dark";
  accentColor: `#${string}`;
} {
  const webApp =
    typeof window === "undefined" ? undefined : window.Telegram?.WebApp;
  const accent = webApp?.themeParams?.button_color;
  return {
    theme: webApp?.colorScheme === "light" ? "light" : "dark",
    accentColor: /^#[0-9a-f]{6}$/i.test(accent ?? "")
      ? (accent as `#${string}`)
      : "#2aabee",
  };
}

export function Providers({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [queryClient] = useState(() => new QueryClient());
  const [appearance] = useState(telegramAppearance);

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
          appearance: {
            ...appearance,
            logo: "/favicon.svg",
            walletList: [],
          },
        }}
      >
        {children}
      </PrivyProvider>
    </QueryClientProvider>
  );
}
