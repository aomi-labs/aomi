import {
  TRANSACTION_SAFETY_NAMES,
  type TransactionSafetyMode,
} from "@aomi-labs/client";
import { connect, json, out, usage, type ConnectFlags } from "../context";
import { loadState } from "../state";

const MODES = Object.keys(TRANSACTION_SAFETY_NAMES) as TransactionSafetyMode[];

/** `strict`, `balanced` or `yolo` (or the wire name) to a mode. */
export function guardMode(name: string): TransactionSafetyMode | undefined {
  const wanted = name.toLowerCase();
  return MODES.find(
    (mode) =>
      mode === wanted ||
      TRANSACTION_SAFETY_NAMES[mode].label.toLowerCase() === wanted,
  );
}

/** `aomi guard [mode]`: the current thread's signing guard, or the account default. */
export async function guard(
  flags: ConnectFlags & { json?: boolean; account?: boolean; thread?: string },
  name?: string,
): Promise<void> {
  if (flags.account && flags.thread)
    throw usage("Choose --account or --thread");
  const mode = name ? guardMode(name) : undefined;
  if (name && !mode) throw usage("Mode is strict, balanced or yolo");
  const thread = flags.account
    ? undefined
    : (flags.thread ?? loadState().thread);
  if (!flags.account && !thread)
    throw usage("No thread yet; pass --account or --thread");
  const aomi = await connect(flags);
  const policy = mode
    ? await aomi.account.guard.set({ mode, thread })
    : await aomi.account.guard.get({ thread });
  if (flags.json) return json(policy);
  out(
    `${TRANSACTION_SAFETY_NAMES[policy.mode].label}  ${TRANSACTION_SAFETY_NAMES[policy.mode].description}`,
  );
}
