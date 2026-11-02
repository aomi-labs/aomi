import "./dottie.css";
import "./live.css";
import { initChrome, initMockDesk, setMode } from "./mock-desk";
import {
  AOMI_API_URL,
  DOTTIE_APPLICATION_ID,
  DOTTIE_TELEGRAM_URL,
} from "./site-config";

const params = new URLSearchParams(window.location.search);

// `?application_id=` overrides the build's App for rehearsals; `?concept`
// forces the sample-data desk even when a live App is configured.
const applicationId =
  params.get("application_id")?.trim() || DOTTIE_APPLICATION_ID;
const telegramUrl = DOTTIE_TELEGRAM_URL;
const live = applicationId !== "" && !params.has("concept");

function scrollToDesk() {
  document.querySelector("#desk")?.scrollIntoView();
}

if (live) {
  initChrome(() => {
    if (telegramUrl) window.open(telegramUrl, "_blank", "noopener");
    else {
      setMode("telegram");
      scrollToDesk();
    }
  }, "SOL DOTTIE");
  // The widget and its wallet stack are heavy; the landing page paints first.
  void import("./live-desk").then(({ mountLiveDesk }) =>
    mountLiveDesk({
      applicationId,
      baseUrl: AOMI_API_URL,
      telegramUrl,
    }),
  );
} else {
  initChrome(() => {
    setMode("telegram");
    scrollToDesk();
  });
  initMockDesk();
}
