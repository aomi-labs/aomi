import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { COLOR_THEME_INIT_SCRIPT } from "@/lib/color-theme";
import "@/styles/globals.css";
import "@/fonts.css";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    head: () => ({
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: "Aomi Build" },
        {
          name: "description",
          content: "Build, deploy, and operate Aomi apps",
        },
      ],
      links: [
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
    component: Outlet,
    shellComponent: RootDocument,
    notFoundComponent: () => (
      <main className="p-8">
        <h1>Page not found</h1>
      </main>
    ),
  },
);

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="aomi-fonts h-full" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: COLOR_THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body
        className="min-h-full font-sans antialiased"
        suppressHydrationWarning
      >
        {children}
        <Scripts />
      </body>
    </html>
  );
}
