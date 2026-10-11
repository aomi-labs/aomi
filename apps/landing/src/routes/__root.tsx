import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { COLOR_THEME_INIT_SCRIPT } from "@/screens/marketing/color-theme";
import NotFound from "@/screens/not-found";
import "@/screens/globals.css";
export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    head: () => ({
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
      ],
      links: [{ rel: "icon", href: "/assets/images/bubble.svg" }],
    }),
    validateSearch: (
      search: Record<string, unknown>,
    ): { surface?: string } => ({
      surface: typeof search.surface === "string" ? search.surface : undefined,
    }),
    component: Outlet,
    shellComponent: RootDocument,
    notFoundComponent: NotFound,
  },
);
const gaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
function RootDocument({ children }: { children: React.ReactNode }) {
  const analytics = gaId && gaId !== "G-XXXXXXXXXX" ? gaId : undefined;
  return (
    <html
      lang="en"
      className="bg-background text-foreground"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: COLOR_THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="min-h-screen antialiased">
        {children}
        <Scripts />
        {analytics && (
          <>
            <script
              async
              src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(analytics)}`}
            />
            <script
              dangerouslySetInnerHTML={{
                __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config',${JSON.stringify(analytics)});`,
              }}
            />
          </>
        )}
      </body>
    </html>
  );
}
