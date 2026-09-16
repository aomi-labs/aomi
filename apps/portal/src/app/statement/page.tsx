import type { Metadata } from "next";
import { StatementView } from "@aomi-labs/widget-lib/host-composition";

export const metadata: Metadata = {
  title: "Usage statement — Aomi",
};

export default function StatementPage() {
  return <StatementView />;
}
