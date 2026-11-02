import { ShieldCheckIcon, ShieldIcon, ZapIcon } from "lucide-react";
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
  guarded_only: {
    id: "guarded_only",
    ...TRANSACTION_SAFETY_NAMES.guarded_only,
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
  unrestricted: {
    id: "unrestricted",
    ...TRANSACTION_SAFETY_NAMES.unrestricted,
    Icon: ZapIcon,
    canBeDefault: false,
    danger: true,
  },
};

/** The levels strictest first, as the menus list them. */
export const TRANSACTION_SAFETY_LEVELS: readonly TransactionSafetyLevel[] = [
  LEVELS.guarded_only,
  LEVELS.balanced,
  LEVELS.unrestricted,
];

export const YOLO_CONFIRM_TITLE = "Turn on Yolo for this chat?";
export const YOLO_CONFIRM_BODY =
  "Aomi will run actions even when a guard flags a critical issue or can't check them. Your wallet signing rules still apply.";

export function transactionSafetyLevel(
  mode: TransactionSafetyMode,
): TransactionSafetyLevel {
  return LEVELS[mode];
}
