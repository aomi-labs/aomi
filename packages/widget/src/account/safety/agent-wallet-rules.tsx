"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AomiApiError,
  WALLET_ERROR_CODES,
  shortAddress,
  type AomiAccountWallet,
  type AomiClient,
  type AomiWalletRuleClientSetting,
  type AomiWalletRuleSettings,
} from "@aomi-labs/client";
import { ListGroup, ListRow } from "@/ui/aomi/list-group";
import { SectionHeader } from "@/ui/aomi/section-header";
import { Switch } from "@/ui/aomi/switch";
import { useConfirmDialog } from "@/ui/aomi/confirm-dialog";
import { familyTag } from "../account-management/wallet-model";

/** How a client row reads: "Portal", "AI clients (MCP)", "Telegram · @Bot". */
function clientName(client: AomiWalletRuleClientSetting): string {
  return client.kind === "telegram"
    ? `Telegram · ${client.label}`
    : client.label;
}

function clientDetail(client: AomiWalletRuleClientSetting): string | undefined {
  if (client.detail) return client.detail;
  if (client.kind === "mcp")
    return "All connected AI clients share this switch";
}

function ruleError(cause: unknown): string {
  const code = cause instanceof AomiApiError ? cause.code : undefined;
  if (code === WALLET_ERROR_CODES.portalSessionRequired)
    return "Change signing rules on Aomi, signed in.";
  return "Couldn't save this change. Try again.";
}

/** "Agent wallet" alone, or with family and address when there are several. */
export function ruleCardTitle(
  wallet: AomiAccountWallet,
  several: boolean,
): string {
  return several
    ? `${wallet.label} · ${familyTag(wallet.family)} ${shortAddress(wallet.address)}`
    : wallet.label;
}

/**
 * One agent wallet's signing rule: Ask is the default and always on; Pause
 * stops all signing; each client may be put on Instant. Every write sends the
 * whole rule at the version that was read; a newer rule is read again.
 */
export function AgentWalletRuleCard({
  client,
  wallet,
  title,
  focused = false,
  initial,
}: {
  client: AomiClient;
  wallet: AomiAccountWallet;
  title: string;
  focused?: boolean;
  initial?: AomiWalletRuleSettings;
}) {
  const [rule, setRule] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const { confirm, dialog } = useConfirmDialog();
  const ref = useRef<HTMLElement>(null);
  const headingId = `rule-${wallet.id}`;

  const load = useCallback(async () => {
    try {
      setRule(await client.account.wallets.walletRule(wallet.id));
    } catch {
      setError("Couldn't load this wallet's rule.");
    }
  }, [client, wallet.id]);
  useEffect(() => {
    if (!initial) void load();
  }, [initial, load]);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView?.({ block: "start" });
  }, [focused]);

  const write = async (paused: boolean, instant: string[]) => {
    if (!rule || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      setRule(
        await client.account.wallets.setWalletRule(wallet.id, {
          rule_version: rule.rule_version,
          paused,
          instant,
        }),
      );
    } catch (cause) {
      if (
        cause instanceof AomiApiError &&
        cause.code === WALLET_ERROR_CODES.ruleVersionConflict
      ) {
        setError("This rule changed elsewhere. Check it and try again.");
        await load();
      } else setError(ruleError(cause));
    } finally {
      setBusy(false);
    }
  };

  const instant = rule?.clients.filter((c) => c.instant).map((c) => c.client);
  const setInstant = async (row: AomiWalletRuleClientSetting, on: boolean) => {
    if (!rule || !instant) return;
    if (
      on &&
      !(await confirm({
        title: "Sign without asking?",
        description: `Trades from ${clientName(row)} will sign without asking.`,
        confirmLabel: "Turn on",
      }))
    )
      return;
    await write(
      rule.paused,
      on ? [...instant, row.client] : instant.filter((id) => id !== row.client),
    );
  };

  return (
    <section
      ref={ref}
      aria-labelledby={headingId}
      data-wallet-rule={wallet.id}
      className="flex scroll-mt-4 flex-col gap-2"
    >
      <SectionHeader
        id={headingId}
        title={title}
        action={
          rule ? (
            <label className="type-meta text-aomi-muted flex items-center gap-2">
              Pause
              <Switch
                checked={rule.paused}
                disabled={busy}
                aria-label={`Pause ${title}`}
                onCheckedChange={(paused) => void write(paused, instant ?? [])}
              />
            </label>
          ) : null
        }
      />
      {rule ? (
        <ListGroup>
          <ListRow
            className="min-h-0 py-2.5"
            title="Ask before each trade"
            description={
              rule.paused
                ? "Paused: nothing signs until you resume"
                : "Trades wait for your approval unless Instant is on"
            }
            trailing={
              <span className="type-meta text-aomi-muted">Always on</span>
            }
          />
          {rule.clients.map((row) => (
            <ListRow
              key={row.client}
              className="min-h-0 py-2.5"
              title={clientName(row)}
              description={clientDetail(row)}
              trailing={
                <label className="type-meta text-aomi-muted flex items-center gap-2">
                  Instant
                  <Switch
                    checked={row.instant}
                    disabled={busy || rule.paused}
                    aria-label={`Instant for ${clientName(row)}`}
                    onCheckedChange={(on) => void setInstant(row, on)}
                  />
                </label>
              }
            />
          ))}
        </ListGroup>
      ) : null}
      {error ? (
        <p role="alert" className="type-meta text-aomi-danger px-0.5">
          {error}
        </p>
      ) : null}
      {dialog}
    </section>
  );
}
