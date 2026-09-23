import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { interpretToolStep } from "./tool-interpreter";
import { ToolStepRow } from "./working-trace-rows";

const labels = (step: ReturnType<typeof interpretToolStep>) =>
  step.chips.map((chip) => chip.label);

describe("working trace contract", () => {
  it.each([
    ["Evm stage", "Stage transaction"],
    ["evm_stage_tx", "Stage transaction"],
    ["svm_stage_ix", "Stage transaction"],
    ["simulate_batch", "Simulate transaction"],
    ["svm_simulate_ix", "Simulate transaction"],
    ["evm_commit_txs", "Commit transactions"],
    ["svm_commit_txs", "Commit transactions"],
    ["brave_search", "Search web"],
    ["activate_skills", "Activate skill"],
    ["get_contract", "Get contract details"],
    ["encode_and_call", "Call contract"],
  ])(
    "keeps %s readable through active and failed results",
    (toolName, title) => {
      expect(interpretToolStep({ toolName }).title).toBe(title);
      expect(
        interpretToolStep({ toolName, result: { status: "complete" } }).title,
      ).toBe(title);
      const failed = interpretToolStep({
        toolName,
        result: { is_error: true, error: "upstream unavailable" },
      });
      expect(failed.title).toBe(title);
      expect(failed.outcome).toBe("failed");
    },
  );

  it("keeps an undeclared skill tool neutral despite familiar payload keys", () => {
    const step = interpretToolStep({
      toolName: "skill_tools::aave_v4_execute",
      argsText: JSON.stringify({ chain_id: 5042, symbol: "USDC" }),
      result: {
        protocol: "aave_v4",
        chain_id: 5042,
        status: "prepared",
        amount: { display: "5 USDC" },
        approval: { required: true },
      },
    });
    expect(step.title).toBe("Aave v4 execute");
    expect(labels(step)).toEqual([]);
    expect(step.confidence).toBe("fallback");
    const failed = interpretToolStep({
      toolName: "skill_tools::aave_v4_execute",
      result: { is_error: true, error: "failed" },
    });
    expect(labels(failed)).toEqual(["Failed"]);
    expect(failed.outcome).toBe("failed");
    expect(
      interpretToolStep({
        toolName: "toString",
        result: { protocol: "aave_v4" },
      }).chips,
    ).toEqual([]);
    expect(
      labels(
        interpretToolStep({
          toolName: "morpho_vault_overview",
          result: { source: "aave_v4", vault: { name: "Wrong owner" } },
        }),
      ),
    ).toEqual([]);
    const spoofedCore = interpretToolStep({
      toolName: "skill_tools::evm_stage_tx",
      result: { chain_id: 5042, staged_ids: [1] },
    });
    expect(spoofedCore.title).toBe("Evm stage tx");
    expect(labels(spoofedCore)).toEqual([]);
    expect(spoofedCore.confidence).toBe("fallback");
    const spoofedProtocol = interpretToolStep({
      toolName: "skill_tools::aave_v4_prepare",
      result: {
        protocol: "aave_v4",
        operation: "supply",
        chain_id: 5042,
        amount: { display: "5 USDC" },
      },
    });
    expect(spoofedProtocol.title).toBe("Aave v4 prepare");
    expect(labels(spoofedProtocol)).toEqual([]);
    expect(spoofedProtocol.confidence).toBe("fallback");
  });

  it("uses resolved EVM transaction ids, not internal simulation steps", () => {
    const step = interpretToolStep({
      toolName: "simulate_batch",
      result: {
        resolved_ids: [7],
        simulation: {
          network: "base",
          batch_success: true,
          steps: [{ step: 1 }, { step: 2 }, { step: 3 }],
        },
      },
    });
    expect(labels(step)).toEqual(["Base", "1 tx", "Passed"]);
    const incomplete = interpretToolStep({
      toolName: "simulate_batch",
      result: {
        resolved_ids: [7],
        simulation_incomplete: true,
        simulation: { network: "base", batch_success: true },
      },
    });
    expect(labels(incomplete)).toContain("Incomplete");
    expect(incomplete.outcome).toBe("incomplete");
    const withoutEvidence = interpretToolStep({
      toolName: "simulate_batch",
      result: { simulation: { network: "base" } },
    });
    expect(withoutEvidence.outcome).toBe("unknown");
    const { container } = render(
      <ToolStepRow
        interpretation={withoutEvidence}
        done
        active={false}
        animate={false}
      />,
    );
    expect(container.querySelector("svg.text-aomi-success")).toBeNull();
  });

  it("counts Solana instructions while staging and one assembled transaction when simulating", () => {
    const stage = interpretToolStep({
      toolName: "svm_stage_ix",
      result: {
        ix_ids: [1, 2, 3],
        instructions: [{ cluster: "mainnet-beta" }],
      },
    });
    expect(labels(stage)).toEqual(["Solana", "3 instructions", "Staged"]);
    const simulation = interpretToolStep({
      toolName: "svm_simulate_ix",
      result: {
        ix_ids: [1, 2, 3],
        cluster: "mainnet-beta",
        simulation: { err: null, units_consumed: 125000 },
      },
    });
    expect(labels(simulation)).toEqual([
      "Solana",
      "1 tx",
      "125,000 compute units",
      "Passed",
    ]);
    const failedStage = interpretToolStep({
      toolName: "svm_stage_ix",
      result: { is_error: true, error: "invalid instruction" },
    });
    expect(labels(failedStage)).toContain("Failed");
    expect(failedStage.outcome).toBe("failed");
  });

  it("shows Commit Service progress and keeps a pending row pending", () => {
    const step = interpretToolStep({
      toolName: "evm_commit_txs",
      result: {
        commits: [
          { chain_family: "evm", chain_ref: "evm:5042", state: "confirmed" },
          {
            chain_family: "evm",
            chain_ref: "evm:5042",
            state: "needs_signature",
          },
        ],
      },
    });
    expect(labels(step)).toEqual([
      "Arc",
      "1/2 confirmed",
      "Awaiting signature",
    ]);
    expect(step.outcome).toBe("waiting");
    const { container, getByText } = render(
      <ToolStepRow interpretation={step} done active={false} animate={false} />,
    );
    expect(getByText("Awaiting signature")).toBeTruthy();
    expect(container.querySelector("svg.text-aomi-success")).toBeNull();
  });

  it("preserves network, count, and state when secondary chips overflow", () => {
    const step = interpretToolStep({
      toolName: "evm_commit_txs",
      result: {
        commits: [
          { chain_family: "evm", chain_ref: "evm:8453", state: "submitted" },
        ],
        tx_outcome: { txHash: `0x${"a".repeat(64)}` },
      },
    });
    const { getByText, queryByText } = render(
      <ToolStepRow
        interpretation={{
          ...step,
          chips: [
            ...step.chips.slice(0, 2),
            { label: "extra one" },
            { label: "extra two" },
            { label: "extra three" },
            ...step.chips.slice(2),
          ],
        }}
        done
        active={false}
        animate={false}
      />,
    );
    expect(getByText("Base")).toBeTruthy();
    expect(getByText("1 tx")).toBeTruthy();
    expect(getByText("Submitted")).toBeTruthy();
    expect(queryByText("extra three")).toBeNull();
  });

  it("does not assign one network to mixed commit views", () => {
    const step = interpretToolStep({
      toolName: "evm_commit_txs",
      result: {
        commits: [
          { chain_family: "evm", chain_ref: "evm:1", state: "confirmed" },
          { chain_family: "evm", chain_ref: "evm:8453", state: "submitted" },
        ],
      },
    });
    expect(labels(step)).toEqual(["1/2 confirmed", "Submitted"]);
  });
});
