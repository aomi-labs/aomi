import type { StatusTone } from "@aomi-labs/widget/controls";

export function transactionStatusTone(status: string): StatusTone {
  switch (status) {
    case "confirmed": return "success";
    case "submitted": return "warning";
    case "failed":
    case "rejected": return "danger";
    default: return "neutral";
  }
}
