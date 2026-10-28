import type { Metadata } from "next";
import { Geist, Geist_Mono, PT_Serif, Source_Serif_4 } from "next/font/google";
import "./globals.css";
import { CookieConsent } from "@/components/analytics/analytics";
import { GoogleAnalytics } from "@/components/analytics/analytics";
import { SettingsInitializer } from "@/components/providers/settings-initializer";
import { WalletProviders } from "@/components/providers/wallet-providers";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

// PT Serif — the aomi display face (statement page headings).
const ptSerif = PT_Serif({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-pt-serif",
});

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["600"],
  variable: "--font-source-serif-4",
});

export const metadata: Metadata = {
  title: "Execution Portal | Aomi Labs",
  description:
    "What should happen onchain? Keep your wallet, act on any protocols across chains.",
  icons: {
    icon: "/assets/images/a.svg",
    shortcut: "/assets/images/a.svg",
    apple: "/assets/images/a.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${ptSerif.variable} ${sourceSerif.variable} font-sans antialiased`}
      >
        <GoogleAnalytics />
        <WalletProviders>
          <SettingsInitializer>
            <div className="relative h-screen w-full overflow-hidden">
              {children}
            </div>
          </SettingsInitializer>
        </WalletProviders>
        <CookieConsent />
      </body>
    </html>
  );
}
