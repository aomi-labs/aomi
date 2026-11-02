import {
  createRootRouteWithContext,
  ErrorComponent,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { COLOR_THEME_INIT_SCRIPT } from "@/lib/color-theme";
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
    component: Outlet,
    shellComponent: RootDocument,
    errorComponent: ({ error }) => {
      void reportRenderError(error);
      return <ErrorComponent error={error} />;
    },
    notFoundComponent: () => (
      <main className="p-8">
        <meta name="robots" content="noindex" />
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
