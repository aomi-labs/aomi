import type {LandingMetadata as Metadata} from "@/lib/metadata";
import RestApiProductPageContent from "./rest-apis-content";
import apiStyles from "./rest-api.module.css";

export const metadata: Metadata = {
  title: "REST APIs | Aomi",
  description:
    "Natural language in, signable transactions out. Use Aomi's Agent API or guarded Pipeline API without giving up custody.",
  robots: { index: false, follow: false },
};

export default function RestApiProductPage() {
  return (
    <div className={apiStyles.marketingTokens}>
      <RestApiProductPageContent
        humanInterfaceHref="/products/widget"
        pluginSdkHref="/products/plugin-sdk"
        useMarketingLayout
      />
    </div>
  );
}
