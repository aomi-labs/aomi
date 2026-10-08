import type { ReactNode } from "react";
import "@aomi-labs/widget/styles.css";
import "./page.css";

export const metadata = {
  title: "Aomi Next.js embed",
  description: "A minimal Aomi widget integration.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
