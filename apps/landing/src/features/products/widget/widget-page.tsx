import type {LandingMetadata as Metadata} from "@/lib/metadata";
import { WidgetProductPageContent } from "./widget-content";
import widgetStyles from "./widget-product.module.css";

export const metadata: Metadata = {
  title: "Human Interface | Aomi",
  description:
    "Put Aomi's chat-to-transaction surface in your product or a Telegram bot while preserving your authentication, wallet, and application policy.",
  robots: { index: false, follow: false },
};

export default function HumanInterfacePage() {
  return (
    <div className={widgetStyles.marketingTokens}>
      <WidgetProductPageContent
        contactHref="/contact"
        productName="HUMAN INTERFACE"
        flat
      />
    </div>
  );
}
