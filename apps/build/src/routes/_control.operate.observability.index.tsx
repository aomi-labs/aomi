import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { OperateView } from "@/features/operate/operate-view";

export const Route = createFileRoute("/_control/operate/observability/")({
  component: OperateObservabilityPage,
});

function OperateObservabilityPage() {
  return (
    <Suspense fallback={null}>
      <OperateView kind="observability" />
    </Suspense>
  );
}
