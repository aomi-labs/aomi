import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { OperateView } from "@/features/operate/operate-view";

export const Route = createFileRoute("/_control/operate/transactions")({
  component: OperateTransactionsPage,
});

function OperateTransactionsPage() {
  return (
    <Suspense fallback={null}>
      <OperateView kind="transactions" />
    </Suspense>
  );
}
