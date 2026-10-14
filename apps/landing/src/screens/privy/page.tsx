"use client";

import {lazy, Suspense} from "react";

const PrivyWidgetClient = lazy(() => import("./privy-widget-client").then(m => ({default: m.PrivyWidgetClient})));

export default function PrivyWidgetPage() {
  return (
    <Suspense fallback={null}>
      <PrivyWidgetClient />
    </Suspense>
  );
}
