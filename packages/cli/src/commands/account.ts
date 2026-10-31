import {
  Aomi,
  isAomiError,
  type CreditBalance,
  type CreditLedger,
} from "@aomi-labs/client";
import {
  baseUrlOf,
  CliError,
  connect,
  deviceAuth,
  json,
  out,
  privateKeyOf,
  usage,
  type ConnectFlags,
  type ShowCode,
} from "../context";
import { updateState } from "../state";

type Flags = ConnectFlags & { json?: boolean };

/** One device sign-in, its code shown by `onCode` (default stderr). */
export async function signIn(
  baseUrl: string,
  onCode?: ShowCode,
): Promise<void> {
  const aomi = new Aomi({ baseUrl, auth: await deviceAuth(baseUrl, onCode) });
  await aomi.auth.login({ for: ["agent", "pipeline"] });
  // Guest threads belong to the guest; the account starts its own.
  updateState({ guest: undefined, thread: undefined });
}

/** `aomi login`: one device code; wallets and providers are on its web page. */
export async function login(flags: Flags): Promise<void> {
  const baseUrl = baseUrlOf(flags);
  await signIn(baseUrl);
  out(`Signed in to ${baseUrl}`);
}

export async function logout(flags: Flags): Promise<void> {
  const aomi = await connect({ backendUrl: flags.backendUrl });
  await aomi.auth.logout();
  updateState({ guest: undefined, thread: undefined });
  out("Signed out");
}

const SIGN_IN = {
  oauth: "aomi login",
  wallet: "--private-key",
  guest: "guest (aomi login to sign in)",
} as Record<string, string>;

export async function whoami(flags: Flags): Promise<void> {
  const aomi = await connect(flags);
  const via = SIGN_IN[aomi.auth.mode] ?? aomi.auth.mode;
  // Device grants are capability tokens: the profile route answers 401.
  const me = await aomi.account.me().catch((error: unknown) => {
    if (
      aomi.auth.mode === "oauth" &&
      isAomiError(error) &&
      error.status === 401
    )
      return null;
    throw error;
  });
  if (flags.json) return json({ signIn: aomi.auth.mode, account: me });
  out(
    `Signed in  ${via}${aomi.auth.mode === "wallet" ? ` ${aomi.wallet?.evm?.address}` : ""}`,
  );
  if (me?.user)
    out(
      `Account    ${me.user.displayName ?? me.user.email ?? ""} (${me.user.id})`,
    );
}

/** Device grants cannot read or change the profile: send those to the web. */
const onWeb = (flags: Flags, aomi: Aomi) => (error: unknown) => {
  if (aomi.auth.mode === "oauth" && isAomiError(error) && error.status === 401)
    throw new CliError(
      `Profile and sign-in methods are managed at ${baseUrlOf(flags)}/settings/account`,
      3,
    );
  throw error;
};

/** `aomi account`: profile, connections and credits. */
export async function show(flags: Flags): Promise<void> {
  const aomi = await connect(flags);
  const [me, balance] = await Promise.all([
    aomi.account.me().catch(onWeb(flags, aomi)),
    aomi.account.credits.get().catch(() => null),
  ]);
  if (flags.json) return json({ account: me, credits: balance });
  if (!me.user) throw new CliError("Not signed in: aomi login", 3);
  out(`Account      ${me.user.displayName ?? ""} (${me.user.id})`);
  for (const login of me.linkedAccounts)
    out(`Login        ${loginLine(login)}`);
  for (const wallet of me.wallets)
    out(`Wallet       ${wallet.family} ${wallet.address}`);
  if (balance) out(`Credits      ${credits(balance.balance_microusd)}`);
}

const loginLine = (login: {
  id: string;
  provider: string;
  displayLabel?: string;
  email?: string;
  subject: string;
}) =>
  `${login.id}  ${login.provider}  ${login.displayLabel ?? login.email ?? login.subject}`;

export async function connections(flags: Flags): Promise<void> {
  const aomi = await connect(flags);
  const logins = await aomi.account.logins.list().catch(onWeb(flags, aomi));
  if (flags.json) return logins.forEach(json);
  for (const login of logins) out(loginLine(login));
}

export async function unlink(
  flags: Flags & { yes?: boolean },
  id: string,
): Promise<void> {
  if (!flags.yes)
    throw usage(
      `Unlinking removes a way to sign in; pass --yes to unlink ${id}`,
    );
  const aomi = await connect(flags);
  await aomi.account.logins.remove(id).catch(onWeb(flags, aomi));
  out(`Unlinked ${id}`);
}

const credits = (microusd: number) =>
  (microusd / 10_000).toLocaleString("en-US", { maximumFractionDigits: 4 });

function printCredits(balance: CreditBalance, ledger: CreditLedger) {
  out(
    `Monthly   ${credits(balance.included.used_microusd)} / ${credits(balance.included.limit_microusd)} used`,
  );
  out(`Balance   ${credits(balance.balance_microusd)} credits`);
  for (const entry of ledger.entries)
    out(
      `${new Date(entry.created_at * 1000).toISOString()}  ${entry.amount_microusd >= 0 ? "+" : ""}${credits(entry.amount_microusd)}  ${entry.entry_kind}${entry.payment_method ? ` via ${entry.payment_method}` : ""}`,
    );
}

export async function showCredits(
  flags: Flags & { limit?: number },
): Promise<void> {
  const aomi = await connect(flags);
  const [balance, ledger] = await Promise.all([
    aomi.account.credits.get(),
    aomi.account.credits.ledger({ limit: flags.limit ?? 25 }),
  ]);
  if (flags.json) return json({ balance, ledger });
  printCredits(balance, ledger);
}

/** Buy credits with the signer's wallet (x402). Retry with the same key. */
export async function fund(
  flags: Flags & { chain?: number; network: string; idempotencyKey: string },
  amount: number,
): Promise<void> {
  if (!Number.isSafeInteger(amount) || amount < 100 || amount > 100_000)
    throw usage("Credits must be a whole number from 100 to 100,000");
  if (!privateKeyOf(flags)) throw usage("Funding pays from --private-key");
  const aomi = await connect(flags);
  const result = await aomi.account.credits.beginFunding({
    amountMicrousd: amount * 10_000,
    method: "wallet",
    chain: flags.network,
    idempotencyKey: flags.idempotencyKey,
  });
  if (flags.json) return json(result);
  out(`Funding ${result.funding_event.id}  ${result.funding_event.status}`);
}

export async function statement(
  flags: Flags & { limit?: number; cursor?: string },
): Promise<void> {
  const aomi = await connect(flags);
  const page = await aomi.account.statement({
    limit: flags.limit,
    cursor: flags.cursor,
  });
  if (flags.json) return json(page);
  for (const entry of page.entries) out(JSON.stringify(entry));
  if (page.next_cursor) out(`next  --cursor ${page.next_cursor}`);
}
