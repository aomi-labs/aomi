import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import Script from "next/script";
import { Providers } from "./providers";
import "./globals.css";

const geistSans = localFont({
  src: "../../../landing/public/assets/landing/home/fonts/geist-latin.woff2",
  variable: "--font-geist-sans",
});

export const metadata: Metadata = {
  title: "Aomi Wallet",
  description: "Link your wallet and authorize Aomi signing from Telegram.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

// `viewport-fit=cover` is what makes the `env(safe-area-inset-*)` padding in
// globals.css do anything; without it Telegram letterboxes the page instead.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <Script
          src="https://telegram.org/js/telegram-web-app.js?59"
          strategy="beforeInteractive"
        />
      </head>
      <body className={geistSans.variable}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
