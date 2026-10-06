import type { AomiUserRef, LinkedAuthAccount } from "./types";
import type { AomiSessionIdentity } from "../types";

/** A session label can help display this account, but never changes its identity. */
export function providerEmailDisplayHint(
  identity: AomiSessionIdentity,
  accounts: readonly LinkedAuthAccount[],
): string | undefined {
  const provider = identity.sessionProvider;
  const subject = identity.walletProviderSubject;
  const label = identity.primaryLabel?.trim();
  if (
    identity.status !== "connected" ||
    (provider !== "privy" && provider !== "para") ||
    !subject ||
    !label ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(label)
  ) {
    return undefined;
  }
  return accounts.some(
    (account) => account.provider === provider && account.subject === subject,
  )
    ? label
    : undefined;
}

/** Prefer a chosen account name, then canonical email, then a verified session display hint. */
export function accountDisplayName(
  user: AomiUserRef | undefined,
  displayEmailHint?: string,
): string {
  const generatedProviderName = /^(privy|para) user$/i.test(
    user?.displayName?.trim() ?? "",
  );
  const email =
    user?.email &&
    !/^0x[a-f0-9]{40}@aomi\.dev$/i.test(user.email) &&
    !/@auth\.aomi\.local$/i.test(user.email)
      ? user.email
      : undefined;
  return (
    (!generatedProviderName ? user?.displayName : undefined) ??
    email ??
    (generatedProviderName ? displayEmailHint : undefined) ??
    "Aomi account"
  );
}
