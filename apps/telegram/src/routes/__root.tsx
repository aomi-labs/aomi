import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import "@/styles/globals.css";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      { title: "Aomi Wallet" },
      {
        name: "description",
        content: "Link your wallet and authorize Aomi signing from Telegram.",
      },
    ],
    links: [
      { rel: "icon", href: "/favicon.svg" },
      { rel: "shortcut icon", href: "/favicon.svg" },
      {
        rel: "preload",
        href: "/assets/fonts/geist-latin.woff2",
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
    ],
  }),
  component: Outlet,
  shellComponent: RootDocument,
  notFoundComponent: () => (
    <main className="p-6">
      <meta name="robots" content="noindex" />
      Page not found
    </main>
  ),
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script src="https://telegram.org/js/telegram-web-app.js?59" />
        <HeadContent />
      </head>
      <body className="geist-sans">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
