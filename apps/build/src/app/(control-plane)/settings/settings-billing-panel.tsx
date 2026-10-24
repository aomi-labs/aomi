"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AomiClient,
  AccountCreditsTransport,
  type CreditLedger,
  type CreditBalance,
} from "@aomi-labs/client";
import type { OperateStatementResult } from "@aomi-labs/deploy";
import { operateFetch } from "@/features/operate/client";
import { CreditCheckoutDialog } from "@aomi-labs/widget/checkout";
import {
  createWalletClient,
  custom,
  type Address,
  type EIP1193Provider,
} from "viem";

const dollars = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    value / 1_000_000,
  );

export function SettingsBillingPanel() {
  const credits = useMemo(() => {
    const client = new AomiClient({ baseUrl: "" });
    return new AccountCreditsTransport(
      client.requestResponse.bind(client),
      "/v1/builder/credits",
    );
  }, []);
  const [position, setPosition] = useState<CreditBalance | null>(null);
  const [ledger, setLedger] = useState<CreditLedger | null>(null);
  const [statement, setStatement] = useState<Pick<
    OperateStatementResult,
    "charges" | "range"
  > | null>(null);
  const [statementError, setStatementError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [identity, setIdentity] = useState<{
    status: "connected" | "disconnected";
    isConnected: boolean;
    address?: Address;
    chainId?: number;
  }>({ status: "disconnected", isConnected: false });
  const provider = () => {
    const value = (window as Window & { ethereum?: EIP1193Provider }).ethereum;
    if (!value)
      throw new Error(
        "Open this page in a browser with an Ethereum wallet installed.",
      );
    return value;
  };
  const refresh = useCallback(async () => {
    const [next, ledger] = await Promise.all([credits.get(), credits.ledger()]);
    setLedger(ledger);
    setPosition(next);
    setError(null);
  }, [credits]);
  useEffect(() => {
    void operateFetch<{
      example?: boolean;
      statement?: Pick<OperateStatementResult, "charges" | "range">;
    }>("usage")
      .then((result) =>
        setStatement(result.example ? null : (result.statement ?? null)),
      )
      .catch((e: Error) => setStatementError(e.message));
  }, []);
  useEffect(() => {
    void refresh().catch((e: Error) => setError(e.message));
  }, [refresh]);
  useEffect(() => {
    const ethereum = (window as Window & { ethereum?: EIP1193Provider })
      .ethereum;
    if (!ethereum) return;
    const update = async () => {
      const accounts = await ethereum.request({ method: "eth_accounts" });
      const chainId = Number(await ethereum.request({ method: "eth_chainId" }));
      setIdentity({
        status: accounts.length ? "connected" : "disconnected",
        isConnected: accounts.length > 0,
        address: accounts[0],
        chainId,
      });
    };
    void update().catch(() => undefined);
    ethereum.on("accountsChanged", update);
    ethereum.on("chainChanged", update);
    return () => {
      ethereum.removeListener("accountsChanged", update);
      ethereum.removeListener("chainChanged", update);
    };
  }, []);
  return (
    <div className="space-y-4">
      <div className="border-border bg-surface-1 rounded-lg border p-5">
        <h2 className="text-lg font-semibold">Builder credits</h2>
        <p className="text-dim mt-1 text-sm">
          Fund hosting and builder charges. Your personal Chat balance is
          separate.
        </p>
        <div className="my-5 text-3xl font-semibold">
          {position ? dollars(position.balance_microusd) : "—"}
        </div>
        {position && position.debt_microusd > 0 && (
          <p role="alert" className="mb-4 text-red-500">
            Pay {dollars(position.debt_microusd)} to restore new deployments and
            paid executions. Retry blocked work after funding.
          </p>
        )}
        <button
          className="bg-foreground text-background rounded-lg px-4 py-2"
          onClick={() => setOpen(true)}
        >
          Add credits
        </button>
        <p className="text-dim mt-3 text-xs">
          Hosting: $10 per active app each month.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-red-500">
          {error}
        </p>
      )}
      <div className="border-border rounded-lg border p-4">
        <h3 className="font-medium">Credit ledger</h3>
        {ledger?.entries.length === 0 && (
          <p className="text-dim mt-3 text-sm">No movements yet.</p>
        )}
        <ul className="divide-border divide-y">
          {ledger?.entries.map((entry) => (
            <li
              key={entry.id}
              className="flex justify-between gap-3 py-3 text-sm"
            >
              <span>
                {entry.entry_kind.replaceAll("_", " ")}
                <small className="text-dim block">
                  {new Date(entry.created_at * 1000).toLocaleString()}
                </small>
              </span>
              <span>{dollars(entry.amount_microusd)}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="border-border rounded-lg border p-4">
        <h3 className="font-medium">Charges</h3>
        <p className="text-dim mt-1 text-xs">
          Posted charges already appear as debits in your credit ledger.
          Historical uncollected charges do not reduce your balance.
        </p>
        {statement?.range && (
          <p className="text-dim mt-2 text-xs">
            {statement.range.fromDate} – {statement.range.toDate}
          </p>
        )}
        {statementError && (
          <p role="alert" className="mt-3 text-sm text-red-500">
            {statementError}
          </p>
        )}
        {!statementError && !statement?.charges.length && (
          <p className="text-dim mt-3 text-sm">No charges for this period.</p>
        )}
        <ul className="divide-border divide-y">
          {statement?.charges.map((charge) => (
            <li
              key={`${charge.applicationId}:${charge.application}:${charge.item}`}
              className="flex justify-between gap-3 py-3 text-sm"
            >
              <span>
                {charge.item}
                <small className="text-dim block">
                  {charge.application} · {charge.events} charges
                </small>
              </span>
              <span>{dollars(charge.amount * 1_000_000)}</span>
            </li>
          ))}
        </ul>
        <a
          href="/operate/usage"
          className="mt-3 inline-block text-sm underline"
        >
          View usage and statements
        </a>
      </div>
      <CreditCheckoutDialog
        open={open}
        onClose={() => setOpen(false)}
        onSuccess={refresh}
        credits={credits}
        wallet={{
          identity,
          connect: async () => {
            const ethereum = provider();
            const accounts = await ethereum.request({
              method: "eth_requestAccounts",
            });
            const chainId = Number(
              await ethereum.request({ method: "eth_chainId" }),
            );
            setIdentity({
              status: "connected",
              isConnected: true,
              address: accounts[0],
              chainId,
            });
          },
          switchChain: async (chainId) => {
            await provider().request({
              method: "wallet_switchEthereumChain",
              params: [{ chainId: `0x${chainId.toString(16)}` }],
            });
            setIdentity((current) => ({ ...current, chainId }));
          },
          signTypedData: async ({ typed_data }) => {
            if (!identity.address)
              throw new Error("Connect your wallet first.");
            if (
              !typed_data?.types ||
              !typed_data.primaryType ||
              !typed_data.message
            )
              throw new Error("Invalid payment authorization.");
            const signature = await createWalletClient({
              transport: custom(provider()),
              account: identity.address,
            }).signTypedData({
              types: typed_data.types,
              primaryType: typed_data.primaryType,
              message: typed_data.message,
              domain: {
                ...typed_data.domain,
                chainId:
                  typed_data.domain?.chainId === undefined
                    ? undefined
                    : Number(typed_data.domain.chainId),
                verifyingContract: typed_data.domain?.verifyingContract as
                  | Address
                  | undefined,
              },
            });
            return { signature };
          },
        }}
      />
    </div>
  );
}
