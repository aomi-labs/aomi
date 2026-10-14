import type { ReactNode } from "react";
import { MarketingFooter } from "./components/footer";
import { MarketingNav } from "./components/nav";
import styles from "./marketing.module.css";
import themeStyles from "./marketing-theme.module.css";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${styles.root} ${themeStyles.theme}`}>
      <MarketingNav />
      {children}
      <MarketingFooter />
    </div>
  );
}
