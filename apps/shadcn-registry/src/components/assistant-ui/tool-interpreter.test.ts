import { describe, expect, it } from "vitest";
import { PencilLineIcon, PuzzleIcon } from "lucide-react";

import { interpretToolStep } from "@/components/assistant-ui/tool-interpreter";

const labelsFor = (chips: { label: string }[]) =>
  chips.map((chip) => chip.label);

describe("tool interpreter", () => {
  it("recognizes web search results", () => {
    const step = interpretToolStep({
      toolName: "Check current ETH price",
      result: {
        args: [
          "Found 3 results:",
          "",
          "1. ETHUSD - Ethereum Price Chart - TradingView",
          "   URL: https://www.tradingview.com/symbols/ETHUSD/",
        ].join("\n"),
      },
    });

    expect(step.title).toBe("Search web");
    expect(labelsFor(step.chips)).toEqual([
      "ETH",
      "3 results",
      "tradingview.com",
    ]);
  });

  it("wraps plain text results before matching", () => {
    const step = interpretToolStep({
      toolName: "Check current ETH price",
      result: [
        "Found 2 results:",
        "",
        "1. ETHUSD - Ethereum Price Chart - TradingView",
        "   URL: https://www.tradingview.com/symbols/ETHUSD/",
      ].join("\n"),
    });

    expect(step.title).toBe("Search web");
    expect(labelsFor(step.chips)).toEqual([
      "ETH",
      "2 results",
      "tradingview.com",
    ]);
  });

  it("unwraps routed tool envelopes before matching", () => {
    const step = interpretToolStep({
      toolName: "Confirm Base network",
      result: {
        __aomi_tool_routes: [{ id: "route-1" }],
        value: {
          chain_name: "base",
          chain_id: 8453,
          rpc_endpoint: "http://127.0.0.1:56293",
          block_number: 48317939,
        },
      },
    });

    expect(step.title).toBe("Check network");
    expect(labelsFor(step.chips)).toEqual(["Base", "48,317,939"]);
  });

  it("uses parsed argsText facts in the fallback path", () => {
    const step = interpretToolStep({
      toolName: "Check USDC",
      argsText: JSON.stringify({ chain_id: 8453 }),
    });

    expect(step.title).toBe("Check USDC");
    expect(labelsFor(step.chips)).toEqual(["USDC", "Base"]);
    expect(step.confidence).toBe("medium");
  });

  it("surfaces error results with normalized status chips", () => {
    const step = interpretToolStep({
      toolName: "Call token contract",
      result: {
        is_error: true,
        error: { code: "rpc_error" },
      },
    });

    expect(step.title).toBe("Call token contract");
    expect(labelsFor(step.chips)).toEqual(["Failed"]);
    expect(step.chips[0].icon).toBeTypeOf("object");
    expect(step.chips[0].dot).toBeUndefined();
    expect(step.failed).toBe(true);
  });

  it("recognizes skill activation", () => {
    const step = interpretToolStep({
      toolName: "Activate skills",
      result: {
        activated: ["aerodrome"],
        rejected: [["common_erc20", "token_budget_trim"]],
        applied_scope: "current_serve_cycle",
      },
    });

    expect(step.title).toBe("Activate skill");
    expect(labelsFor(step.chips)).toEqual(["Aerodrome"]);
    expect(step.chips[0].icon).toBe(PuzzleIcon);
    expect(step.chips[0].icon).not.toBe(step.icon);
    expect(step.failed).toBe(false);
  });

  it("uses the display name for LI.FI skill activation", () => {
    const step = interpretToolStep({
      toolName: "Activate skills",
      result: {
        activated: ["common_erc20", "lifi_swap"],
        applied_scope: "current_serve_cycle",
      },
    });

    expect(step.title).toBe("Activate skill");
    expect(labelsFor(step.chips)).toEqual(["Common erc20", "Lifi"]);
  });

  it("shows LI.FI quote chain, amounts, and token direction", () => {
    const step = interpretToolStep({
      toolName: "Quote Base swap 0.05 USDC to ETH",
      result: {
        quote_id: "lifi_q_5c95b4e6841348fbba3c4e66374498a7",
        chain_id: 8453,
        from_token: {
          symbol: "USDC",
          address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
          decimals: 6,
          chain_id: 8453,
          name: "USD Coin",
          is_native: false,
        },
        to_token: {
          symbol: "ETH",
          address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
          decimals: 18,
          chain_id: 8453,
          name: "Native token",
          is_native: true,
        },
        from_amount: {
          raw: "50000",
          display: "0.05 USDC",
        },
        estimate: {
          to_amount_raw: "28514600000000",
          to_amount_display: "0.0000285146 ETH",
          to_amount_min_raw: "28372100000000",
          to_amount_min_display: "0.0000283721 ETH",
          slippage_bps: 50,
        },
      },
    });

    expect(step.title).toBe("Quote Base swap 0.05 USDC to ETH");
    expect(labelsFor(step.chips)).toEqual([
      "Base",
      "0.05 USDC",
      "0.0000285146 ETH",
      "USDC -> ETH",
    ]);
    expect(step.chips[0].icon).toBeTypeOf("function");
    expect(step.chips[1].icon).toBeTypeOf("object");
    expect(step.chips[2].icon).toBeTypeOf("object");
  });

  it("shows LI.FI approval chain from nested token metadata", () => {
    const step = interpretToolStep({
      toolName: "Prepare exact USDC approval for LI.FI Base swap",
      result: {
        quote_id: "lifi_q_5c95b4e6841348fbba3c4e66374498a7",
        approval_required: true,
        current_allowance: "0",
        required_allowance: "50000",
        approval: {
          spender: "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae",
          token: {
            symbol: "USDC",
            address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
            decimals: 6,
            chain_id: 8453,
          },
          amount_raw: "50000",
          amount: {
            raw: "50000",
            display: "0.05 USDC",
          },
          policy: "exact",
        },
      },
    });

    expect(step.title).toBe("Prepare exact USDC approval for LI.FI Base swap");
    expect(labelsFor(step.chips)).toEqual(["Base", "USDC", "0.05 USDC"]);
    expect(step.chips[0].icon).toBeTypeOf("function");
  });

  it("shows Lifi instead of LI for LI.FI swap prep", () => {
    const step = interpretToolStep({
      toolName: "Prepare LI.FI Base swap transaction for 0.05 USDC to ETH",
      result: {
        quote_id: "lifi_q_5c95b4e6841348fbba3c4e66374498a7",
        chain_id: 8453,
        from_token: {
          symbol: "USDC",
          chain_id: 8453,
        },
        to_token: {
          symbol: "ETH",
          chain_id: 8453,
        },
        from_amount: {
          raw: "50000",
          display: "0.05 USDC",
        },
        estimate: {
          to_amount_display: "0.0000285146 ETH",
        },
        stage_tx: {
          to: "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae",
          data: { raw: "0xabcdef" },
          value: "0",
          kind: "lifi_swap",
        },
      },
    });

    expect(step.title).toBe(
      "Prepare LI.FI Base swap transaction for 0.05 USDC to ETH",
    );
    expect(labelsFor(step.chips)).toEqual([
      "Base",
      "Lifi",
      "0.05 USDC",
      "0.0000285146 ETH",
      "USDC -> ETH",
    ]);
  });

  it("recognizes Base chain context", () => {
    const step = interpretToolStep({
      toolName: "Confirm Base network and current block time",
      result: {
        chain_name: "base",
        chain_id: 8453,
        rpc_endpoint: "http://127.0.0.1:56293",
        block_number: 48314732,
        gas_price_wei: "1004545855",
      },
    });

    expect(step.title).toBe("Check network");
    expect(labelsFor(step.chips)).toEqual(["Base", "48,314,732"]);
    expect(step.chips[0].icon).toBeTypeOf("function");
    expect(step.chips[0].dot).toBeUndefined();
    expect(step.chips[1].icon).toBeTypeOf("object");
  });

  it("shows Solana cluster and slot separately from EVM context", () => {
    const step = interpretToolStep({
      toolName: "Check Solana network",
      result: {
        cluster: "mainnet-beta",
        rpc_endpoint: "https://api.mainnet-beta.solana.com",
        supported_clusters: ["devnet", "localnet", "mainnet-beta", "testnet"],
        current_slot: 433493809,
        latest_blockhash: "3SJGv7ovUNSNLB83ZceNiyJBMRVttk7YxcojzYLBTEErg",
        address: "HZpj6CD9R4asaSM98mkWzfgowfQnCGA5Hu6zcwoPvRpW",
        lamports: 29425461,
      },
    });

    expect(step.title).toBe("Check network");
    expect(labelsFor(step.chips)).toEqual(["Solana", "433,493,809"]);
    expect(step.confidence).toBe("high");
    expect(step.chips[0].icon).toBeTypeOf("function");
    expect(step.chips[1].icon).toBeTypeOf("object");
  });

  it("shows the visible SPL amount and known token symbol", () => {
    const step = interpretToolStep({
      toolName: "Get SPL token holdings",
      result: {
        cluster: "mainnet-beta",
        owner: "HZpj6CD9R4asaSM98mkWzfgowfQnCGA5Hu6zcwoPvRpW",
        program_id: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        accounts: [
          {
            pubkey: "6cSHGy5AjHEeqwema69qBVz1mMmk5MKUyztLJqqPQmPd",
            account: {
              data: {
                program: "spl-token",
                parsed: {
                  info: {
                    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                    tokenAmount: {
                      amount: "148008",
                      decimals: 6,
                      uiAmount: 0.148008,
                      uiAmountString: "0.148008",
                    },
                  },
                },
              },
            },
          },
        ],
      },
    });

    expect(step.title).toBe("Get SPL token holdings");
    expect(labelsFor(step.chips)).toEqual(["0.148008 USDC"]);
    expect(step.chips[0].icon).toBeTypeOf("object");
    expect(step.confidence).toBe("high");
  });

  it("shows the visible SPL amount without inventing an unknown symbol", () => {
    const step = interpretToolStep({
      toolName: "Get SPL token holdings",
      result: {
        cluster: "mainnet-beta",
        owner: "HZpj6CD9R4asaSM98mkWzfgowfQnCGA5Hu6zcwoPvRpW",
        holdings: [
          {
            mint: "UnknownMint111111111111111111111111111111111",
            amount: "123456",
            decimals: 6,
            ui_amount_string: "0.123456",
          },
        ],
        accounts: [],
      },
    });

    expect(labelsFor(step.chips)).toEqual(["0.123456"]);
    expect(step.chips[0].icon).toBeTypeOf("object");
  });

  it("shows Jupiter input, output, and token direction like LI.FI", () => {
    const step = interpretToolStep({
      toolName: "Prepare 0.001 SOL to USDC Jupiter swap",
      result: {
        ix_ids: [7, 8, 9],
        version: "v0",
        address_lookup_tables: ["ALT111111111111111111111111111111111111111"],
        quote: {
          input_token: {
            symbol: "SOL",
            name: "Wrapped SOL",
            mint: "So11111111111111111111111111111111111111112",
            decimals: 9,
            verified: true,
          },
          output_token: {
            symbol: "USDC",
            name: "USD Coin",
            mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            decimals: 6,
            verified: true,
          },
          input: { raw: "1000000", display: "0.001 SOL" },
          expected_output: { raw: "73903", display: "0.073903 USDC" },
          minimum_output: { raw: "73534", display: "0.073534 USDC" },
          slippage_bps: 50,
          context_slot: 433493809,
        },
      },
    });

    expect(step.title).toBe("Prepare 0.001 SOL to USDC Jupiter swap");
    expect(labelsFor(step.chips)).toEqual([
      "Solana",
      "0.001 SOL",
      "0.073903 USDC",
      "SOL → USDC",
    ]);
    expect(step.confidence).toBe("high");
  });

  it("recognizes native balances", () => {
    const step = interpretToolStep({
      toolName: "Check connected wallet balance on Base",
      result: {
        address: "0xda65d415cc9d5ddc2a08bdffc996750755fc3cf0",
        balance_wei: "865899754337366",
        balance_eth: "0.000865899754337366",
        nonce: 594,
      },
    });

    expect(step.title).toBe("Check connected wallet balance on Base");
    expect(labelsFor(step.chips)).toEqual(["0xda65...3cf0", "0.00087"]);
    expect(step.chips[1].icon).toBeTypeOf("function");
  });

  it("standardizes token resolution chips", () => {
    const step = interpretToolStep({
      toolName: "Resolve USDC on Base",
      result: {
        found: true,
        count: 1,
        contracts: [
          {
            address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
            chain: "base",
            chain_id: 8453,
            name: "FiatTokenProxy",
            symbol: "USDC",
          },
        ],
      },
    });

    expect(step.title).toBe("Resolve contract");
    expect(labelsFor(step.chips)).toEqual(["Base", "USDC"]);
    expect(step.chips[0].icon).toBeTypeOf("function");
    expect(step.chips[1].icon).toBeTypeOf("object");
  });

  it("omits not-found badges for token misses", () => {
    const step = interpretToolStep({
      toolName: "Resolve AERO token",
      result: {
        found: false,
        count: 0,
        contracts: [],
      },
    });

    expect(step.title).toBe("Resolve token");
    expect(labelsFor(step.chips)).toEqual(["AERO"]);
  });

  it("shows chain for token misses when the payload carries one", () => {
    const step = interpretToolStep({
      toolName: "Resolve AERO token",
      result: {
        found: false,
        count: 0,
        chain_id: 8453,
        contracts: [],
      },
    });

    expect(step.title).toBe("Resolve token");
    expect(labelsFor(step.chips)).toEqual(["Base", "AERO"]);
  });

  it("recognizes ERC-20 balance calls without token-specific formatting", () => {
    const step = interpretToolStep({
      toolName: "Check USDC balance on Base",
      result: {
        success: true,
        tx: {
          from: "0xda65d415cc9d5ddc2a08bdffc996750755fc3cf0",
          to: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          input:
            "0x70a08231000000000000000000000000da65d415cc9d5ddc2a08bdffc996750755fc3cf0",
          chain_id: 8453,
        },
        result_decoded: {
          decoded: {
            type: "uint256",
            decoded: "131961",
          },
        },
      },
    });

    expect(step.title).toBe("Check token balance");
    expect(labelsFor(step.chips)).toEqual(["Base", "USDC", "0xda65...3cf0"]);
    expect(step.chips[0].icon).toBeTypeOf("function");
    expect(step.chips[1].icon).toBeTypeOf("object");
    expect(step.chips[2].icon).toBeTypeOf("object");
  });

  it("recognizes ERC-20 decimal reads", () => {
    const step = interpretToolStep({
      toolName: "Check USDT decimals on Base",
      result: {
        success: true,
        tx: {
          to: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
          input: "0x313ce567",
          chain_id: 8453,
        },
        result_decoded: {
          decoded: {
            type: "uint256",
            decoded: "6",
          },
        },
      },
    });

    expect(step.title).toBe("Read token decimals");
    expect(labelsFor(step.chips)).toEqual(["Base", "USDT", "6 decimals"]);
    expect(step.chips[2].icon).toBeTypeOf("object");
  });

  it("recognizes allowance checks without value chips", () => {
    const step = interpretToolStep({
      toolName: "Check USDC allowance for Aerodrome router",
      result: {
        success: true,
        tx: {
          from: "0xda65d415cc9d5ddc2a08bdffc996750755fc3cf0",
          to: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          input:
            "0xdd62ed3e000000000000000000000000da65d415cc9d5ddc2a08bdffc996750755fc3cf0000000000000000000000000cf77a3ba9a5ca399b7c97c74d54e5b1beb874e43",
          chain_id: 8453,
        },
        result_decoded: {
          decoded: {
            type: "uint256",
            decoded: "0",
          },
        },
      },
    });

    expect(step.title).toBe("Check allowance");
    expect(labelsFor(step.chips)).toEqual([
      "Base",
      "USDC",
      "0xda65...3cf0",
      "0xcf77...4e43",
    ]);
    expect(step.chips[2].icon).toBeTypeOf("object");
  });

  it("falls back to the model label for protocol-specific calls", () => {
    const step = interpretToolStep({
      toolName: "Check Aerodrome volatile USDC AERO pool",
      result: {
        success: true,
        tx: {
          from: "0xda65d415cc9d5ddc2a08bdffc996750755fc3cf0",
          to: "0x420DD381b31aEf6683db6B902084cB0FFECe40Da",
          input:
            "0x79bc57d5000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913000000000000000000000000940181a94a35a4569e4529a3cdfb74e38fd986310000000000000000000000000000000000000000000000000000000000000000",
          chain_id: 8453,
        },
        result_decoded: {
          decoded: {
            as_address: "0x6cdcb1c4a4d1c3c6d054b27ac5b77e89eafb971d",
          },
        },
      },
    });

    expect(step.title).toBe("Check Aerodrome volatile USDC AERO pool");
    expect(labelsFor(step.chips)).toEqual([
      "Base",
      "0xda65...3cf0",
      "0x420d...40da",
    ]);
    expect(step.chips[0].icon).toBeTypeOf("function");
    expect(step.chips[1].icon).toBeTypeOf("object");
    expect(step.chips[2].icon).toBeTypeOf("object");
  });

  it("recognizes staged swaps", () => {
    const step = interpretToolStep({
      toolName: "Stage Aerodrome USDC to AERO swap",
      result: {
        chain_id: 8453,
        data: "0xcac88ea9000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913000000000000000000000000940181a94a35a4569e4529a3cdfb74e38fd98631",
        kind: "swap",
        pending_tx_id: 2,
        current_lifecycle: "queued",
      },
    });

    expect(step.title).toBe("Stage Aerodrome USDC to AERO swap");
    expect(labelsFor(step.chips)).toEqual(["Base", "Swap", "2 txs", "Queued"]);
    expect(step.chips[0].icon).toBeTypeOf("function");
    expect(step.chips[1].icon).toBeTypeOf("object");
    expect(step.chips[2].icon).toBeTypeOf("object");
  });

  it("capitalizes staged ERC-20 approval labels and uses action and tx icons", () => {
    const step = interpretToolStep({
      toolName: "Stage exact USDC approval for Aerodrome swap",
      result: {
        chain_id: 8453,
        data: "0x095ea7b3000000000000000000000000cf77a3ba9a5ca399b7c97c74d54e5b1beb874e430000000000000000000000000000000000000000000000000000000000002710",
        kind: "erc20_approve",
        pending_tx_id: 1,
        current_lifecycle: "queued",
      },
    });

    expect(step.title).toBe("Stage exact USDC approval for Aerodrome swap");
    expect(labelsFor(step.chips)).toEqual([
      "Base",
      "Approve",
      "1 tx",
      "Queued",
    ]);
    expect(step.chips[1].icon).toBe(PencilLineIcon);
    expect(step.chips[2].icon).toBeTypeOf("object");
  });

  it("keeps a generic icon on unknown staged action chips", () => {
    const step = interpretToolStep({
      toolName: "Stage custom governance action",
      result: {
        chain_id: 8453,
        data: "0x12345678",
        kind: "delegate_vote",
        pending_tx_id: 3,
        current_lifecycle: "queued",
      },
    });

    expect(labelsFor(step.chips)).toEqual([
      "Base",
      "Delegate vote",
      "3 txs",
      "Queued",
    ]);
    expect(step.chips[1].icon).toBeTypeOf("object");
  });

  it("does not infer routes from hardcoded protocol or token addresses", () => {
    const step = interpretToolStep({
      toolName: "Quote Aerodrome AERO to USDC",
      result: {
        success: true,
        tx: {
          from: "0xda65d415cc9d5ddc2a08bdffc996750755fc3cf0",
          to: "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43",
          input:
            "0x5509a1ac000000000000000000000000940181a94a35a4569e4529a3cdfb74e38fd98631000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913",
          chain_id: 8453,
        },
      },
    });

    expect(step.title).toBe("Quote Aerodrome AERO to USDC");
    expect(labelsFor(step.chips)).toEqual([
      "Base",
      "0xda65...3cf0",
      "0xcf77...4e43",
    ]);
  });

  it("recognizes simulations", () => {
    const step = interpretToolStep({
      toolName: "Simulate exact USDC approval plus Aerodrome swap on Base",
      result: {
        simulation: {
          batch_success: true,
          network: "base",
          total_gas: 262888,
          steps: [{ step: 1 }, { step: 2 }],
        },
      },
    });

    expect(step.title).toBe("Simulate batch");
    expect(labelsFor(step.chips)).toEqual([
      "Base",
      "2 txs",
      "262,888 gas",
      "Success",
    ]);
    expect(step.chips[0].icon).toBeTypeOf("function");
    expect(step.chips[1].icon).toBeTypeOf("object");
    expect(step.chips[2].icon).toBeTypeOf("object");
    expect(step.chips[3].icon).toBeTypeOf("object");
    expect(step.chips[3].dot).toBeUndefined();
  });

  it("recognizes successful Solana simulations", () => {
    const step = interpretToolStep({
      toolName: "Simulate staged Solana instructions",
      result: {
        simulation: {
          err: null,
          logs: ["Program 11111111111111111111111111111111 success"],
          units_consumed: 450,
        },
        last_batch_status: "SVM ixs [1] passed",
        ix_ids: [1],
      },
    });

    expect(step.title).toBe("Simulate batch");
    expect(labelsFor(step.chips)).toEqual(["1 tx", "Success"]);
  });

  it("recognizes pending wallet approval", () => {
    const step = interpretToolStep({
      toolName: "Commit Aerodrome USDC to AERO swap batch",
      result: {
        chain_id: 8453,
        status: "pending_approval",
        tx_ids: [1, 2],
      },
    });

    expect(step.title).toBe("Await wallet approval");
    expect(labelsFor(step.chips)).toEqual([
      "Base",
      "2 txs",
      "Pending approval",
    ]);
    expect(step.chips[0].icon).toBeTypeOf("function");
    expect(step.chips[1].icon).toBeTypeOf("object");
    expect(step.chips[2].icon).toBeTypeOf("object");
    expect(step.chips[2].dot).toBeUndefined();
  });

  it("shows the Solana transaction count while awaiting wallet approval", () => {
    const step = interpretToolStep({
      toolName: "Commit Jupiter swap",
      result: {
        status: "pending_approval",
        chain_kind: "svm",
        svm_ix_ids: [1, 2, 3, 4, 5, 6],
        unsigned_tx: "AQAAAAAAAA",
        cluster: "mainnet-beta",
      },
    });

    expect(step.title).toBe("Await wallet approval");
    expect(labelsFor(step.chips)).toEqual(["6 txs", "Pending approval"]);
  });
  it("recognizes a delegated task with the child label and staged count", () => {
    const step = interpretToolStep({
      toolName: "task",
      argsText: JSON.stringify({
        label: "swap-worker",
        app: "default",
        prompt: "swap half my USDC",
      }),
      result: {
        agent_id: "task-agent:9f2c1a2b3c4d",
        status: "completed",
        staged_count: 1,
      },
    });

    expect(step.title).toBe("Delegated: swap-worker");
    expect(labelsFor(step.chips)).toEqual(["1a2b3c4d", "staged 1"]);
    expect(step.failed).toBe(false);
  });

  it("falls back to a generic delegation title without args", () => {
    const step = interpretToolStep({
      toolName: "task",
      result: {
        agent_id: "task-agent:9f2c1a2b3c4d",
        status: "completed",
        staged_count: 0,
      },
    });

    expect(step.title).toBe("Delegated task");
    expect(labelsFor(step.chips)).toEqual(["1a2b3c4d"]);
  });

  it("marks a non-completed delegation as failed", () => {
    const step = interpretToolStep({
      toolName: "task",
      argsText: JSON.stringify({ label: "approvals-auditor" }),
      result: {
        agent_id: "task-agent:0011223344",
        status: "stalled",
        staged_count: 0,
      },
    });

    expect(step.title).toBe("Delegated: approvals-auditor");
    expect(labelsFor(step.chips)).toEqual(["11223344", "Stalled"]);
    expect(step.failed).toBe(true);
  });
});
