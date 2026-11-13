"use client";

import { cn } from "@/lib/cn";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, Minus } from "lucide-react";
import {
  shortAddress,
  type AccountTransport,
  type AomiRuleChange,
  type AomiRulesAdminWallet,
  type AomiWalletRules,
} from "@aomi-labs/client";
import { AomiButton } from "@/ui/aomi/button";
import { AomiSheet } from "@/ui/aomi/aomi-sheet";
import { listGroupClass } from "@/ui/aomi/list-group";
import {
  SheetAlert,
  SheetHeader,
  WaitingButton,
} from "@/wallet/picker/sheet-parts";
import { useAomiWalletKit } from "@/wallet/context";
import { signOutAndDisconnect } from "@/wallet/account/sign-out";
import { utf8ToBase64 } from "@/wallet/account/encoding";
import type { AomiWalletKit } from "@/wallet/types";
import {
  rulesErrorCode,
  rulesFailure,
  sameWallet,
  timeUntil,
} from "./rules-model";

/** The client a rule change is read and decided with. */
export type RulesClient = { account: Pick<AccountTransport, "rules"> };

const familyName = (family: AomiRulesAdminWallet["family"]) =>
  family === "evm" ? "EVM" : "Solana";

/** The signer's name among the account's wallets, else its short address. */
export function walletName(
  wallet: AomiRulesAdminWallet,
  kit: Pick<AomiWalletKit, "wallets">,
): string {
  const row = kit.wallets.find((entry) =>
    sameWallet(wallet, entry.family, entry.address),
  );
  const short = shortAddress(wallet.address);
  return row?.label && row.label !== short ? `${row.label} (${short})` : short;
}

/**
 * The wallet of the signer's family connected here: null when it is the
 * signer, else what to tell the user.
 */
function signerProblem(
  signer: AomiRulesAdminWallet,
  kit: AomiWalletKit,
): string | null {
  const connected =
    signer.family === "evm" ? kit.identity.address : kit.identity.svmAddress;
  const sign =
    signer.family === "evm" ? kit.signMessage : kit.signSolanaMessage;
  const wanted = walletName(signer, kit);
  if (!connected)
    return `Connect ${wanted} to sign. No ${familyName(signer.family)} wallet is connected.`;
  if (!sameWallet(signer, signer.family, connected))
    return `Connect ${wanted} to sign. ${shortAddress(connected)} is connected now.`;
  return sign ? null : `${wanted} can't sign messages here.`;
}

/** Ask the connected wallet of the signer's family to sign the exact text. */
async function signChange(
  signer: AomiRulesAdminWallet,
  message: string,
  kit: AomiWalletKit,
): Promise<string> {
  if (signer.family === "evm") {
    if (!kit.signMessage) throw new Error("No EVM signer");
    return (await kit.signMessage({ non_typed_data: message })).signature;
  }
  if (!kit.signSolanaMessage) throw new Error("No Solana signer");
  const signed = await kit.signSolanaMessage({
    signer: signer.address,
    message: utf8ToBase64(message),
    cluster: kit.identity.svmCluster,
    description: "Approve a rule change for your agent wallet.",
  });
  return signed.signature;
}

/**
 * One waiting rule change: its lines (a line that gives the agent power is
 * marked), when it expires, Decline, and Approve or, when a wallet is the
 * admin, Sign in wallet. Used in the wallet's Manage sheet and on
 * `/rules/:id`.
 */
export function RuleChangeCard({
  change,
  client,
  onDecided,
  onStale,
  onLater,
  className,
}: {
  change: AomiRuleChange;
  client: RulesClient;
  /** The change was approved or declined; `rules` is the wallet after it. */
  onDecided: (rules: AomiWalletRules, outcome: "approved" | "declined") => void;
  /** The change is no longer open, or the rules moved: read them again. */
  onStale: () => void;
  /** Close the card and leave the change waiting. */
  onLater?: () => void;
  className?: string;
}) {
  const kit = useAomiWalletKit();
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [, tick] = useState(0);
  const mounted = useRef(true);
  // The wallet signed in this attempt; a failure after that is not "nothing
  // was signed".
  const signed = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // Keep "expires in" current while the card stays open, and read the change
  // again the moment it expires.
  const expiresAt = change.expires_at;
  useEffect(() => {
    const remaining = expiresAt * 1000 - Date.now();
    if (remaining <= 0) return;
    const minute = setInterval(() => tick((count) => count + 1), 30_000);
    const end = setTimeout(
      () => {
        tick((count) => count + 1);
        onStale();
      },
      Math.min(remaining + 500, 2 ** 31 - 1),
    );
    return () => {
      clearInterval(minute);
      clearTimeout(end);
    };
    // onStale is the caller's reload; a new identity must not restart the timers.
  }, [expiresAt]);

  const left = timeUntil(change.expires_at);
  const signer = change.signer;
  const problem = signer ? signerProblem(signer, kit) : null;

  const run = async (
    step: "approve" | "decline",
    send: () => Promise<AomiWalletRules>,
  ) => {
    if (busy) return;
    setBusy(step);
    setError(null);
    setStale(false);
    signed.current = false;
    try {
      const rules = await send();
      onDecided(rules, step === "approve" ? "approved" : "declined");
    } catch (caught) {
      if (!mounted.current) return;
      const code = rulesErrorCode(caught);
      if (code === "login_stale") setStale(true);
      else if (code === "rules_change_not_open" || code === "rules_changed") {
        setError(rulesFailure(caught, ""));
        onStale();
      } else if (code)
        setError(rulesFailure(caught, "Couldn’t do that. Try again."));
      else if (signed.current)
        setError(
          "Your wallet signed, but the change couldn’t be sent. Check the rules before trying again.",
        );
      // A wallet prompt the user closed is not a failure of the change.
      else if (step === "approve" && signer)
        setError("Nothing was signed. Try again.");
      else setError("Couldn’t do that. Try again.");
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const approve = () =>
    run("approve", async () => {
      if (!signer) return client.account.rules.approveChange(change.id);
      if (!change.sign_message) throw new Error("No message to sign");
      const signature = await signChange(signer, change.sign_message, kit);
      signed.current = true;
      return client.account.rules.approveChange(change.id, { signature });
    });

  return (
    <section
      aria-label={`Rule change for ${change.wallet_name}`}
      data-rule-change={change.id}
      className={cn(listGroupClass, "flex flex-col gap-3 p-3.5", className)}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="type-row min-w-0 truncate">
          Rule change · {change.wallet_name}
        </h4>
        <span className="type-meta text-aomi-muted shrink-0">
          {left ? `expires in ${left}` : "expired"}
        </span>
      </div>
      <ChangeLines change={change} />
      {signer ? (
        <p className="type-meta text-aomi-muted">
          {problem ??
            `Only ${walletName(signer, kit)} can approve this. Aomi can't.`}
        </p>
      ) : null}
      {error ? <SheetAlert>{error}</SheetAlert> : null}
      {stale ? (
        <div
          role="alert"
          className="rounded-control bg-aomi-warning/15 type-meta flex items-center justify-between gap-3 px-3 py-2"
        >
          <span>For a rule change, sign in again.</span>
          <AomiButton
            size="sm"
            onClick={() =>
              void signOutAndDisconnect(kit).catch(() => undefined)
            }
          >
            Sign in again
          </AomiButton>
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        {onLater ? (
          <AomiButton
            variant="ghost"
            size="sm"
            disabled={busy !== null}
            onClick={onLater}
          >
            Later
          </AomiButton>
        ) : null}
        <span className="flex-1" />
        <AomiButton
          size="sm"
          disabled={busy !== null || !left}
          onClick={() =>
            void run("decline", () =>
              client.account.rules.declineChange(change.id),
            )
          }
        >
          {busy === "decline" ? "Declining…" : "Decline"}
        </AomiButton>
        <AomiButton
          variant="primary"
          size="sm"
          disabled={busy !== null || Boolean(problem) || !left}
          onClick={() => void approve()}
        >
          {signer
            ? busy === "approve"
              ? "Waiting for wallet…"
              : "Sign in wallet"
            : busy === "approve"
              ? "Approving…"
              : "Approve"}
        </AomiButton>
      </div>
    </section>
  );
}

/** A change's lines; one that loosens gets a red up arrow. */
function ChangeLines({ change }: { change: AomiRuleChange }) {
  return (
    <ul className="type-control flex flex-col gap-1.5">
      {change.lines.map((line, index) => (
        <li
          key={index}
          data-loosens={line.loosens || undefined}
          className="flex items-start gap-2"
        >
          {line.loosens ? (
            <ArrowUp
              aria-label="Gives the agent more"
              className="text-aomi-danger mt-0.5 size-4 shrink-0"
            />
          ) : (
            <Minus
              aria-hidden
              className="text-aomi-muted mt-0.5 size-4 shrink-0"
            />
          )}
          <span className={line.loosens ? "text-aomi-danger" : undefined}>
            {line.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

const DECIDED: Record<
  Exclude<AomiRuleChange["state"], "awaiting_admin">,
  { title: string; detail: string }
> = {
  applied: { title: "Approved", detail: "The new rules are in force." },
  declined: { title: "Declined", detail: "The rules stay as they were." },
  expired: {
    title: "Expired",
    detail: "Nobody approved it in time. The rules stay as they were.",
  },
  superseded: {
    title: "Replaced by a newer change",
    detail: "Open the wallet in Settings to see what is waiting now.",
  },
};

export type RuleChangePanelProps = {
  /** The owner's session client; other credentials can read but not decide. */
  client: RulesClient;
  /** The change id from the page URL. */
  changeId: string;
  onClose: () => void;
};

type PanelState =
  | { step: "loading" }
  | { step: "ready"; change: AomiRuleChange }
  | { step: "failed"; title: string; detail?: string };

/**
 * The `/rules/:id` page's sheet: the change's card while it waits, else how
 * it ended.
 */
export function RuleChangePanel({
  client,
  changeId,
  onClose,
}: RuleChangePanelProps) {
  const [state, setState] = useState<PanelState>({ step: "loading" });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let stale = false;
    // Another change's card or outcome must not show under this id.
    setState((current) =>
      current.step === "ready" && current.change.id !== changeId
        ? { step: "loading" }
        : current,
    );
    client.account.rules.getChange(changeId).then(
      (change) => {
        if (!stale) setState({ step: "ready", change });
      },
      (error: unknown) => {
        if (stale) return;
        setState(
          rulesErrorCode(error) === "rules_change_not_found"
            ? {
                step: "failed",
                title: "This change doesn’t exist",
                detail: "It may belong to another account.",
              }
            : {
                step: "failed",
                title: "This change couldn’t be loaded",
                detail: "Try again later.",
              },
        );
      },
    );
    return () => {
      stale = true;
    };
  }, [client, changeId, reload]);

  let header: { title: string; description?: string };
  let body: ReactNode = null;
  if (state.step === "loading") {
    header = { title: "Rule change" };
    body = <WaitingButton>Loading…</WaitingButton>;
  } else if (state.step === "failed") {
    header = { title: state.title, description: state.detail };
    body = (
      <AomiButton
        className="h-10 w-full"
        onClick={() => {
          setState({ step: "loading" });
          setReload((count) => count + 1);
        }}
      >
        Try again
      </AomiButton>
    );
  } else if (state.change.state === "awaiting_admin") {
    const { change } = state;
    header = {
      title: "Review rule change",
      description: change.proposed_by.startsWith("agent:")
        ? "Aomi asks to change this wallet's rules."
        : "You asked to change this wallet's rules.",
    };
    body = (
      <RuleChangeCard
        change={change}
        client={client}
        className="w-full"
        onDecided={(_, outcome) =>
          // A decision that lands after the page moved to another change is
          // that other change's, not this one's.
          setState((current) =>
            current.step === "ready" && current.change.id === change.id
              ? {
                  step: "ready",
                  change: {
                    ...change,
                    state: outcome === "approved" ? "applied" : "declined",
                  },
                }
              : current,
          )
        }
        onStale={() => setReload((count) => count + 1)}
      />
    );
  } else {
    const decided = DECIDED[state.change.state];
    header = {
      title: decided.title,
      description: `${state.change.wallet_name}. ${decided.detail}`,
    };
    body = (
      <div className={cn(listGroupClass, "w-full p-3.5")}>
        <ChangeLines change={state.change} />
      </div>
    );
  }

  return (
    <AomiSheet backdrop={false}>
      <SheetHeader
        title={header.title}
        description={header.description}
        onClose={onClose}
      />
      <section
        aria-label="Rule change"
        data-rule-change-panel={
          state.step === "ready" ? state.change.state : state.step
        }
        className="flex flex-col items-center gap-4 px-5 pb-5"
      >
        {body}
      </section>
    </AomiSheet>
  );
}
