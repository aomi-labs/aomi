"use client";

import { useEffect, useState } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { WalletConfigurationMissing } from "@/screens/wallet-shell";

import { privyAppId } from "@/lib/config";
import { webApp } from "@/lib/telegram-ui";

type Appearance = { theme: "light" | "dark"; accentColor: `#${string}` };

/** Telegram's own palette, so Privy's native modal does not arrive as a white
 *  sheet on top of a dark Mini App. Our own surfaces are styled from the Aomi
 *  design system instead — only the third-party modal needs this. */
function telegramAppearance(): Appearance {
  const app = webApp();
  const accent = app?.themeParams?.button_color;
  return {
    theme: app?.colorScheme === "light" ? "light" : "dark",
    accentColor: /^#[0-9a-f]{6}$/i.test(accent ?? "")
      ? (accent as `#${string}`)
      : "#2aabee",
  };
}

export function Providers({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [appearance, setAppearance] = useState<Appearance>(telegramAppearance);

  // Previously read once and never again, so a user who switched theme mid
  // session kept the palette the app booted with. A modal already on screen
  // may not restyle, but the next one opens correct.
  useEffect(() => {
    const app = webApp();
    if (!app?.onEvent) return;
    const sync = () => setAppearance(telegramAppearance());
    app.onEvent("themeChanged", sync);
    return () => app.offEvent?.("themeChanged", sync);
  }, []);

  // `PrivyProvider` throws on an empty app id, which would take down the
  // prerender as well as any deployment missing the variable. Failing to a
  // readable message beats a blank screen, and it keeps the build honest about
  // an env that is inlined at build time.
  if (!privyAppId) return <WalletConfigurationMissing />;

  return (
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
  );
}
