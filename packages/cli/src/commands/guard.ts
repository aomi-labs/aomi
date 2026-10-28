import type { TransactionSafetyMode } from "@aomi-labs/client";
import { connect, json, out, usage, type ConnectFlags } from "../context";
import { loadState } from "../state";

const MODES = ["guarded_only", "balanced", "unrestricted"];

/** `aomi guard [mode]`: the current thread's signing guard, or the account default. */
export async function guard(
  flags: ConnectFlags & { json?: boolean; account?: boolean; thread?: string },
  mode?: string,
): Promise<void> {
  if (flags.account && flags.thread)
    throw usage("Choose --account or --thread");
  if (mode && !MODES.includes(mode))
    throw usage(`Mode is one of ${MODES.join(", ")}`);
  const thread = flags.account
    ? undefined
    : (flags.thread ?? loadState().thread);
  if (!flags.account && !thread)
    throw usage("No thread yet; pass --account or --thread");
  const aomi = await connect(flags);
  const policy = mode
    ? await aomi.account.guard.set({
        mode: mode as TransactionSafetyMode,
        thread,
      })
    : await aomi.account.guard.get({ thread });
  if (flags.json) return json(policy);
  out(`${policy.mode}  revision ${policy.revision}`);
}
