import { describe, expect, it } from "vitest";
import { AppWindowIcon } from "lucide-react";
import { getAppIcon } from "@/components/icons/app-map";
import { getSkillIcon } from "@/components/icons/skills";
import { interpretToolStep } from "./index";
import type { TraceAttribution } from "./attribution";

const attribution: TraceAttribution = {
  apps: [
    { name: "hoodit", metadata: { tool_names: ["hoodit_search_tokens"] } },
    { name: "hyperliquid", metadata: { tool_names: ["hyperliquid_orders"] } },
  ],
  skills: [
    {
      id: "lifi_swap",
      name: "lifi_swap",
      injectedTools: ["lifi_get_quote", "lifi_prepare_swap_tx"],
    },
    {
      id: "hoodit/markets",
      name: "hoodit/markets",
      injectedTools: ["hoodit_search_tokens"],
    },
  ],
};

describe("trace attribution", () => {
  it("shows app artwork and readable skill names without changing the raw identifier", () => {
    const result = {
      activated: [
        "hoodit/markets",
        "hyperliquid/portfolio",
        "hoodit/coin-scanner",
      ],
    };
    const step = interpretToolStep({
      toolName: "activate_skills",
      result,
      attribution,
    });
    expect(step.chips.map((chip) => chip.label)).toEqual([
      "Hoodit · Markets",
      "Hyperliquid · Portfolio",
      "Hoodit · Coin Scanner",
    ]);
    expect(step.chips[0].icon).toBe(getAppIcon("hoodit"));
    expect(step.chips[1].icon).toBe(getAppIcon("hyperliquid"));
    expect(result.activated[0]).toBe("hoodit/markets");
  });

  it("attributes pending, completed and failed injected calls", () => {
    for (const result of [
      undefined,
      { quote_id: "q" },
      { error: "Quote unavailable" },
    ]) {
      const step = interpretToolStep({
        toolName: "lifi_get_quote",
        result,
        attribution,
      });
      expect(step.chips[0]).toMatchObject({
        label: "Lifi Swap",
        icon: getSkillIcon("lifi_swap"),
        title: "Skill: Lifi Swap",
      });
      expect(step.failed).toBe(Boolean(result && "error" in result));
    }
  });

  it("shows a single combined app/skill badge for an owned tool", () => {
    const step = interpretToolStep({
      toolName: "hoodit_search_tokens",
      attribution,
    });
    expect(step.chips.map((chip) => chip.label)).toEqual(["Hoodit · Markets"]);
  });

  it("uses app metadata when a skill owner is not available", () => {
    const step = interpretToolStep({
      toolName: "hyperliquid_orders",
      attribution,
    });
    expect(step.chips[0]).toMatchObject({
      label: "Hyperliquid",
      icon: getAppIcon("hyperliquid"),
    });
  });

  it("does not attribute generic calls or guesses from names/previous activations", () => {
    for (const toolName of [
      "get_chain_context",
      "stage_tx",
      "lifi_unknown",
      "Swap ETH to USDC",
    ]) {
      const step = interpretToolStep({
        toolName,
        attribution,
        relatedResults: [{ activated: ["lifi_swap"] }],
      });
      expect(
        step.chips.some(
          (chip) =>
            chip.id?.startsWith("skill:") || chip.id?.startsWith("app:"),
        ),
      ).toBe(false);
    }
  });

  it("retains attribution in serialized child-agent results and routed envelopes", () => {
    const step = interpretToolStep({
      toolName: "activate_skills",
      result: JSON.stringify({
        __aomi_tool_return: true,
        __aomi_tool_value: { activated: ["hoodit/markets"] },
      }),
      attribution,
    });
    expect(step.chips[0].label).toBe("Hoodit · Markets");
  });

  it("shows requested skills while pending and only accepted skills after completion", () => {
    const input = {
      toolName: "activate_skills",
      argsText: JSON.stringify({ skill_ids: ["hoodit/markets", "lifi_swap"] }),
      attribution,
    };
    expect(interpretToolStep(input).chips).toHaveLength(2);
    expect(
      interpretToolStep({
        ...input,
        result: {
          activated: ["lifi_swap"],
          rejected: [["hoodit/markets", "unavailable"]],
        },
      }).chips.map((chip) => chip.label),
    ).toEqual(["Lifi Swap"]);
  });

  it("keeps same-named skills from different apps distinct", () => {
    const step = interpretToolStep({
      toolName: "activate_skills",
      result: { activated: ["hoodit/portfolio", "hyperliquid/portfolio"] },
      attribution,
    });
    expect(step.chips).toHaveLength(2);
    expect(new Set(step.chips.map((chip) => chip.id)).size).toBe(2);
  });

  it("uses a generic app icon for unknown and community publisher identities", () => {
    const step = interpretToolStep({
      toolName: "activate_skills",
      result: { activated: ["unknown/portfolio", "hyperliquid/trading"] },
      attribution: {
        apps: [
          {
            name: "hyperliquid",
            applicationId: 77,
            label: "Community Exchange",
            metadata: { registered_via: "activate_apps" },
          },
        ],
      },
    });
    expect(step.chips[0]).toMatchObject({
      label: "Unknown · Portfolio",
      icon: AppWindowIcon,
    });
    expect(step.chips[1]).toMatchObject({
      label: "Community Exchange · Trading",
      icon: AppWindowIcon,
    });
  });

  it("does not guess when multiple apps or skills declare the same bare tool", () => {
    const step = interpretToolStep({
      toolName: "lookup",
      attribution: {
        apps: ["one", "two"].map((name) => ({
          name,
          metadata: { tool_names: ["lookup"] },
        })),
        skills: ["one/read", "two/read"].map((id) => ({
          id,
          name: id,
          injectedTools: ["lookup"],
        })),
      },
    });
    expect(step.chips).toEqual([]);
  });
});
