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
import GlobalError from "@/features/errors/global-error";
import { reportRenderError } from "@/lib/report-render-error";
import "@/styles/globals.css";
import "@aomi-labs/app-kit/fonts.css";
import geistLatin from "@aomi-labs/app-kit/fonts/geist-latin.woff2?url";
import geistMonoLatin from "@aomi-labs/app-kit/fonts/geist-mono-latin.woff2?url";
import ptSerif400Latin from "@aomi-labs/app-kit/fonts/pt-serif-400-latin.woff2?url";
import ptSerif700Latin from "@aomi-labs/app-kit/fonts/pt-serif-700-latin.woff2?url";
import sourceSerif4Latin from "@aomi-labs/app-kit/fonts/source-serif-4-latin.woff2?url";
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
        // Same URLs as the @font-face sources, so the preloads are reused.
        ...[
          geistLatin,
          geistMonoLatin,
          ptSerif400Latin,
          ptSerif700Latin,
          sourceSerif4Latin,
        ].map((href) => ({
          rel: "preload",
          href,
          as: "font",
          type: "font/woff2",
          crossOrigin: "anonymous" as const,
        })),
      ],
    }),
    headers: () => ({ "Cache-Control": "private, no-store" }),
    component: RootLayout,
    shellComponent: RootDocument,
    errorComponent: ({ error }) => {
      void reportRenderError(error);
      return (
        <GlobalError
          error={
            error instanceof Error ? error : new Error("Portal rendering failed")
          }
        />
      );
    },
    notFoundComponent: () => (
      <main className="p-8">
        <meta name="robots" content="noindex" />
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
