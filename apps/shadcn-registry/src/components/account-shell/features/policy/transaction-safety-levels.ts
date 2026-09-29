import { ShieldCheckIcon, ShieldIcon, ZapIcon } from "lucide-react";
import type { ComponentType } from "react";
import type { TransactionSafetyMode } from "@aomi-labs/client";

export type TransactionSafetyLevel = {
  id: TransactionSafetyMode;
  label: string;
  description: string;
  Icon: ComponentType<{ className?: string }>;
  /** Yolo is chat-scoped: it is never offered as an account default. */
  canBeDefault: boolean;
  danger: boolean;
};

/** User-facing names for the guard policy modes, strictest first. */
export const TRANSACTION_SAFETY_LEVELS: readonly TransactionSafetyLevel[] = [
  {
    id: "guarded_only",
    label: "Strict",
    description: "Only actions a protocol guard covers",
    Icon: ShieldIcon,
    canBeDefault: true,
    danger: false,
  },
  {
    id: "balanced",
    label: "Balanced",
    description: "Blocks critical guard findings",
    Icon: ShieldCheckIcon,
    canBeDefault: true,
    danger: false,
  },
  {
    id: "unrestricted",
    label: "Yolo",
    description: "Runs even when guards flag it",
    Icon: ZapIcon,
    canBeDefault: false,
    danger: true,
  },
];

export const YOLO_CONFIRM_TITLE = "Turn on Yolo for this chat?";
export const YOLO_CONFIRM_BODY =
  "Aomi will run actions even when a guard flags a critical issue or can't check them. Your wallet signing rules still apply.";

export function transactionSafetyLevel(
  mode: TransactionSafetyMode,
): TransactionSafetyLevel {
  return (
    TRANSACTION_SAFETY_LEVELS.find((level) => level.id === mode) ??
    TRANSACTION_SAFETY_LEVELS[1]!
  );
}
