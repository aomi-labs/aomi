import { ShieldCheckIcon, ShieldIcon, ShieldOffIcon } from "lucide-react";
import type { ComponentType } from "react";
import {
  TRANSACTION_SAFETY_NAMES,
  type TransactionSafetyMode,
} from "@aomi-labs/client";

export type TransactionSafetyLevel = {
  id: TransactionSafetyMode;
  label: string;
  description: string;
  Icon: ComponentType<{ className?: string }>;
  /** Yolo is chat-scoped: it is never offered as an account default. */
  canBeDefault: boolean;
  danger: boolean;
};

/** The guard policy modes, with the shared names and this UI's icons. */
const LEVELS: Record<TransactionSafetyMode, TransactionSafetyLevel> = {
  strict: {
    id: "strict",
    ...TRANSACTION_SAFETY_NAMES.strict,
    Icon: ShieldIcon,
    canBeDefault: true,
    danger: false,
  },
  balanced: {
    id: "balanced",
    ...TRANSACTION_SAFETY_NAMES.balanced,
    Icon: ShieldCheckIcon,
    canBeDefault: true,
    danger: false,
  },
  yolo: {
    id: "yolo",
    ...TRANSACTION_SAFETY_NAMES.yolo,
    // Not the lightning of the Instant lane: Yolo turns guards off, it does
    // not skip approval.
    Icon: ShieldOffIcon,
    canBeDefault: false,
    danger: true,
  },
};

/** The levels strictest first, as the menus list them. */
export const TRANSACTION_SAFETY_LEVELS: readonly TransactionSafetyLevel[] = [
  LEVELS.strict,
  LEVELS.balanced,
  LEVELS.yolo,
];

export const YOLO_CONFIRM_TITLE = "Turn on Yolo for this chat?";
export const YOLO_CONFIRM_BODY =
  "Aomi will run actions even when a guard flags a critical issue or can't check them. Your wallet signing rules still apply.";

export function transactionSafetyLevel(
  mode: TransactionSafetyMode,
): TransactionSafetyLevel {
  return LEVELS[mode];
}
