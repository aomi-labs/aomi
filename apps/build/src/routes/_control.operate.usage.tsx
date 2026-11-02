import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { OperateView } from "@/features/operate/operate-view";

export const Route = createFileRoute("/_control/operate/usage")({
  component: OperateUsagePage,
});

function OperateUsagePage() {
  return (
    <Suspense fallback={null}>
      <OperateView kind="usage" />
    </Suspense>
  );
}
