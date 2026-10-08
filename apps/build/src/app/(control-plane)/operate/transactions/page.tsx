import { Suspense } from "react";
import { OperateView } from "@/features/operate/operate-view";

export default function OperateTransactionsPage() {
  return (
    <Suspense fallback={null}>
      <OperateView kind="transactions" />
    </Suspense>
  );
}
