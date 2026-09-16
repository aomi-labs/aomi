import type { Metadata } from "next";
import { StatementView } from "@portal/features/usage";

export const metadata: Metadata = {
  title: "Usage statement — Aomi",
};

export default function StatementPage() {
  return <StatementView />;
}
