"use client";

import { AomiFrame } from "@aomi-labs/widget/frame";
import { LandingPrivyProvider } from "../components/landing-privy-provider";

export function PrivyWidgetClient() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-950 p-4 text-stone-100 md:p-8">
      <div className="h-[min(760px,calc(100vh-2rem))] w-full max-w-[960px] md:h-[min(780px,calc(100vh-4rem))]">
        <LandingPrivyProvider>
          <AomiFrame.Root
            height="100%"
            width="100%"
            walletPosition="footer"
            walletFamilies={["evm", "solana"]}
            backendUrl="/"
          >
            <AomiFrame.Header />
            <AomiFrame.Composer
              withControl
              controlBarProps={{ hideApiKey: true, hideNetwork: false }}
            />
          </AomiFrame.Root>
        </LandingPrivyProvider>
      </div>
    </main>
  );
}
