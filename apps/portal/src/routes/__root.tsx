import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { CookieConsent } from "@/components/analytics/cookie-consent";
import { GoogleAnalytics } from "@/components/analytics/google-analytics";
import { SettingsInitializer } from "@/components/providers/settings-initializer";
import { WalletProviders } from "@/components/providers/wallet-providers";
import { readE2EWallet } from "@/server-functions";
import GlobalError from "@/screens/global-error";
import "@/screens/globals.css";
import "@/fonts.css";
export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    loader: () => readE2EWallet(),
    head: () => ({
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: "Execution Portal | Aomi Labs" },
        {
          name: "description",
          content:
            "What should happen onchain? Keep your wallet, act on any protocols across chains.",
        },
      ],
      links: [
        { rel: "icon", href: "/assets/images/a.svg" },
        { rel: "apple-touch-icon", href: "/assets/images/a.svg" },
        {
          rel: "preload",
          href: "/assets/fonts/google/geist-latin.woff2",
          as: "font",
          type: "font/woff2",
          crossOrigin: "anonymous",
        },
        {
          rel: "preload",
          href: "/assets/fonts/google/geist-mono-latin.woff2",
          as: "font",
          type: "font/woff2",
          crossOrigin: "anonymous",
        },
        {
          rel: "preload",
          href: "/assets/fonts/google/pt-serif-400-latin.woff2",
          as: "font",
          type: "font/woff2",
          crossOrigin: "anonymous",
        },
        {
          rel: "preload",
          href: "/assets/fonts/google/pt-serif-700-latin.woff2",
          as: "font",
          type: "font/woff2",
          crossOrigin: "anonymous",
        },
        {
          rel: "preload",
          href: "/assets/fonts/google/source-serif-4-latin.woff2",
          as: "font",
          type: "font/woff2",
          crossOrigin: "anonymous",
        },
      ],
    }),
    headers: () => ({ "Cache-Control": "private, no-store" }),
    component: RootLayout,
    shellComponent: RootDocument,
    errorComponent: ({ error }) => (
      <GlobalError
        error={
          error instanceof Error ? error : new Error("Portal rendering failed")
        }
      />
    ),
    notFoundComponent: () => (
      <main className="p-8">
        <h1>Page not found</h1>
      </main>
    ),
  },
);
function RootLayout() {
  const e2eWallet = Route.useLoaderData();
  return (
    <>
      <GoogleAnalytics />
      <WalletProviders e2eWallet={e2eWallet}>
        <SettingsInitializer>
          <div className="relative h-screen w-full overflow-hidden">
            <Outlet />
          </div>
        </SettingsInitializer>
      </WalletProviders>
      <CookieConsent />
    </>
  );
}
function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="aomi-fonts font-sans antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
