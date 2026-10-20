import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AomiApiError } from "@aomi-labs/client";
import { interpretToolStep } from "@/thread/tool-interpreter/interpret";
import { ToolStepRow } from "@/thread/working-trace-rows";
import { AccountOverviewFixture } from "@/test/account-overview-fixture";
import { walletRefusalOf } from "./wallet-refusal";

describe("walletRefusalOf", () => {
  it("reads an approve refusal's code and details", () => {
    expect(
      walletRefusalOf(
        new AomiApiError(
          403,
          "commit_wallet_no_access",
          "HTTP 403",
          false,
          undefined,
          {
            code: "commit_wallet_no_access",
            agent_wallet_id: "g-1",
            wallet_name: "World",
            connection_key: "oauth:c1",
          },
        ),
      ),
    ).toEqual({
      kind: "no_access",
      walletId: "g-1",
      walletName: "World",
      connectionKey: "oauth:c1",
    });
    expect(
      walletRefusalOf(new AomiApiError(403, "commit_approval_forbidden", "x")),
    ).toBeNull();
  });

  it("reads a tool error's marker, JSON-escaped or not", () => {
    const text =
      'evm_commit_txs: "Hoodit" is paused [err.type=commit_wallet_paused agent_wallet_id=g-2 wallet_name="Hoodit" connection_key=portal]';
    const refusal = {
      kind: "paused",
      walletId: "g-2",
      walletName: "Hoodit",
      connectionKey: "portal",
    };
    expect(walletRefusalOf(text)).toEqual(refusal);
    expect(walletRefusalOf(JSON.stringify({ error: text }))).toEqual(refusal);
    // The backend's exact text (crates/tools commit_diagnostics::wallet_refusal).
    expect(
      walletRefusalOf(
        "This connection can't use 'Main [EVM] wallet'. The user allows it in Aomi (Settings → Connections). Nothing was signed. [err.type=commit_wallet_no_access agent_wallet_id=6f1c2b8e-0000-4000-8000-000000000001 wallet_name=\"Main [EVM] wallet\" connection_key=oauth:claude]",
      ),
    ).toEqual({
      kind: "no_access",
      walletId: "6f1c2b8e-0000-4000-8000-000000000001",
      walletName: "Main [EVM] wallet",
      connectionKey: "oauth:claude",
    });
    // Codex finding 17: a bare `]` inside the quoted name.
    expect(
      walletRefusalOf(
        "'Trading ] Main' is paused. Nothing was signed. [err.type=commit_wallet_paused agent_wallet_id=g-3 wallet_name=\"Trading ] Main\" connection_key=cli]",
      ),
    ).toEqual({
      kind: "paused",
      walletId: "g-3",
      walletName: "Trading ] Main",
      connectionKey: "cli",
    });
    expect(walletRefusalOf("[err.type=commit_wallet_archived]")).toEqual({
      kind: "archived",
    });
    expect(walletRefusalOf("[err.type=signing_denied]")).toBeNull();
  });
});

describe("a refused trade in the trace", () => {
  beforeEach(() =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ pause_all: false, wallets: [] })),
    ),
  );
  afterEach(() => vi.unstubAllGlobals());

  it("shows the paused card with Resume under the failed step", async () => {
    const step = interpretToolStep({ toolName: "evm_commit_txs" });
    render(
      <ToolStepRow
        interpretation={{ ...step, failed: true, outcome: "failed" }}
        detailText={JSON.stringify(
          '[err.type=commit_wallet_paused agent_wallet_id=g-2 wallet_name="Hoodit"]',
        )}
        done
        active={false}
        animate={false}
      />,
      { wrapper: AccountOverviewFixture },
    );
    // The card loads on demand.
    expect(
      await screen.findByText('"Hoodit" is paused', {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Nothing was signed. Resume the wallet to trade from it.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
  });

  it("offers Resume all while the account is paused, and lifts only that", async () => {
    const writes: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        const method =
          init?.method ?? (input instanceof Request ? input.method : "GET");
        if (method !== "GET")
          writes.push(`${method} ${new URL(url, "http://x").pathname}`);
        return Response.json({
          pause_all: !writes.length,
          wallets: [
            {
              id: "g-2",
              name: "Hoodit",
              paused: true,
              archived_at: null,
              app: null,
              last_used_at: null,
              created_at: 1,
              addresses: [],
              connections: [],
            },
          ],
        });
      }),
    );
    const step = interpretToolStep({ toolName: "evm_commit_txs" });
    render(
      <ToolStepRow
        interpretation={{ ...step, failed: true, outcome: "failed" }}
        detailText={JSON.stringify(
          '[err.type=commit_wallet_paused agent_wallet_id=g-2 wallet_name="Hoodit"]',
        )}
        done
        active={false}
        animate={false}
      />,
      { wrapper: AccountOverviewFixture },
    );
    expect(
      await screen.findByText(
        "All agent wallets are paused",
        {},
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resume all" }));
    await screen.findByText("Done. Ask again to trade.");
    // The wallet's own pause stays.
    expect(writes).toEqual(["PUT /v1/account/pause-all"]);
  }, 15_000);
});
