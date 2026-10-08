import { Suspense } from "react";
import { OperateView } from "@/features/operate/operate-view";

export default function OperateObservabilityPage() {
  return (
    <Suspense fallback={null}>
      <OperateView kind="observability" />
    </Suspense>
  );
}
