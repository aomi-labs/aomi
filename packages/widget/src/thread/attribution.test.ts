import { describe, expect, it } from "vitest";
import { AppWindowIcon, PackageIcon, PuzzleIcon } from "lucide-react";
import { getSkillIcon } from "@/icons/skills/skill-icons";
import type { ToolChip } from "@aomi-labs/client/trace";
import { interpretToolStep, type TraceAttribution } from "./attribution";
import { traceIcon } from "./trace-icons";

const labelsFor = (chips: { label: string }[]) =>
  chips.map((chip) => chip.label);

/** A chip with its icon key resolved to what the widget draws. */
const drawn = (chip: ToolChip | undefined) =>
  chip?.icon ? { ...chip, icon: traceIcon(chip.icon) } : chip;

const attribution: TraceAttribution = {
  agents: [
    {
      agent_id: 7,
      agent: "aomi/hoodit",
      display_name: "Hoodit",
      metadata: { tool_names: ["hoodit_search_tokens"] },
    },
    {
      agent_id: 7,
      agent: "aomi/hyperliquid",
      display_name: "Hyperliquid",
      metadata: { tool_names: ["hyperliquid_orders"] },
    },
  ],
};

describe("trace attribution", () => {
  it("shows one readable chip per package without changing the raw identifier", () => {
    const result = {
      activated: [
        "aomi/hoodit/markets",
        "aomi/hyperliquid/portfolio",
        "aomi/hoodit/coin-scanner",
      ],
    };
    const step = interpretToolStep({
      toolName: "activate_package",
      result,
      attribution,
    });
    expect(step.title).toBe("Activate package");
    expect(
      step.chips.map(({ id, packageId, label, title }) => ({
        id,
        packageId,
        label,
        title,
      })),
    ).toEqual([
      {
        id: "package:aomi/hoodit",
        packageId: "aomi/hoodit",
        label: "Hoodit",
        title: "Hoodit · Skills: markets, coin-scanner",
      },
      {
        id: "package:aomi/hyperliquid",
        packageId: "aomi/hyperliquid",
        label: "Hyperliquid",
        title: "Hyperliquid · Skills: portfolio",
      },
    ]);
    expect(drawn(step.chips[0])?.icon).toBe(PackageIcon);
    expect(result.activated[0]).toBe("aomi/hoodit/markets");
  });

  it("attributes a tool to the agent that declares it", () => {
    const step = interpretToolStep({
      toolName: "hyperliquid_orders",
      attribution,
    });
    expect(drawn(step.chips[0])).toMatchObject({
      label: "Hyperliquid",
      icon: AppWindowIcon,
    });
  });

  it("attributes arbitrary agent names using declarations, regardless of tool spelling", () => {
    for (const name of ["atlas", "weather-service", "community_42"]) {
      const catalog: TraceAttribution = {
        agents: [
          {
            agent_id: 42,
            agent: `publisher/${name}`,
            display_name: "Custom Agent",
            metadata: {
              registered_via: "activate_toolsets",
              tool_names: ["fetch_record"],
            },
          },
        ],
      };
      expect(
        drawn(
          interpretToolStep({ toolName: "fetch_record", attribution: catalog })
            .chips[0],
        ),
      ).toMatchObject({
        id: `agent:publisher/${name}`,
        label: "Custom Agent",
        icon: AppWindowIcon,
      });
      expect(
        interpretToolStep({ toolName: `${name}_unknown`, attribution: catalog })
          .chips,
      ).toEqual([]);
    }
  });

  it("does not infer agent ownership from prefixes, even for registered hosted agents", () => {
    const agents = ["hoodit", "hyperliquid", "atlas"].map((name) => ({
      agent_id: 42,
      agent: `publisher/${name}`,
      display_name: name,
      metadata: {},
    }));
    for (const toolName of [
      "hoodit_get_portfolio",
      "hyperliquid_orders",
      "atlas_lookup",
      "atlas/lookup",
    ]) {
      expect(
        interpretToolStep({ toolName, attribution: { agents } }).chips,
      ).toEqual([]);
    }
  });

  it("uses the declared owner even when a tool is named after another agent", () => {
    const step = interpretToolStep({
      toolName: "hoodit_get_portfolio",
      attribution: {
        agents: [
          {
            agent_id: 7,
            agent: "aomi/hoodit",
            display_name: "Hoodit",
            metadata: {},
          },
          {
            agent_id: 7,
            agent: "aomi/analytics",
            display_name: "Analytics",
            metadata: { tool_names: ["hoodit_get_portfolio"] },
          },
        ],
      },
    });
    expect(step.chips[0].label).toBe("Analytics");
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
            chip.id?.startsWith("skill:") || chip.id?.startsWith("agent:"),
        ),
      ).toBe(false);
    }
  });

  it("retains attribution in serialized child-agent results and routed envelopes", () => {
    const step = interpretToolStep({
      toolName: "activate_package",
      result: JSON.stringify({
        __aomi_tool_return: true,
        __aomi_tool_value: { activated: ["aomi/hoodit/markets"] },
      }),
      attribution,
    });
    expect(step.chips[0]).toMatchObject({
      packageId: "aomi/hoodit",
      label: "Hoodit",
    });
  });

  it("shows requested packages while pending and only accepted packages after completion", () => {
    const input = {
      toolName: "activate_package",
      argsText: JSON.stringify({
        ids: ["aomi/hoodit/markets", "lifi_swap"],
      }),
      attribution,
    };
    expect(
      interpretToolStep(input).chips.map((chip) => chip.packageId),
    ).toEqual(["aomi/hoodit", "lifi_swap"]);
    expect(
      interpretToolStep({
        ...input,
        result: {
          activated: ["lifi_swap"],
          rejected: [["aomi/hoodit/markets", "unavailable"]],
        },
      }).chips.map((chip) => chip.label),
    ).toEqual(["LI.FI"]);
  });

  it("keeps same-named skills from different packages distinct", () => {
    const step = interpretToolStep({
      toolName: "activate_package",
      result: {
        activated: ["aomi/hoodit/portfolio", "aomi/hyperliquid/portfolio"],
      },
      attribution,
    });
    expect(step.chips).toHaveLength(2);
    expect(new Set(step.chips.map((chip) => chip.id)).size).toBe(2);
  });

  it("uses the generic package icon for unknown and community publishers", () => {
    const step = interpretToolStep({
      toolName: "activate_package",
      result: {
        activated: ["unknown/portfolio", "publisher/hyperliquid/trading"],
      },
      attribution: {
        agents: [
          {
            agent_id: 77,
            agent: "publisher/hyperliquid",
            display_name: "Community Exchange",
            metadata: { registered_via: "activate_toolsets" },
          },
        ],
      },
    });
    expect(drawn(step.chips[0])).toMatchObject({
      packageId: "unknown/portfolio",
      label: "Portfolio",
      icon: PackageIcon,
    });
    expect(drawn(step.chips[1])).toMatchObject({
      packageId: "publisher/hyperliquid",
      label: "Hyperliquid",
      icon: PackageIcon,
    });
  });

  it("names an activated package as the packages feed does", () => {
    const step = interpretToolStep({
      toolName: "activate_package",
      result: { activated: ["acme/feeds/prices"] },
      attribution: {
        packages: [
          { id: "acme/feeds", label: "Price Feeds", Icon: PackageIcon },
        ],
      },
    });
    expect(step.chips[0]).toMatchObject({
      packageId: "acme/feeds",
      label: "Price Feeds",
      title: "Price Feeds · Skills: prices",
    });
  });

  it("does not borrow official artwork for a package outside the catalog", () => {
    const step = interpretToolStep({
      toolName: "activate_package",
      result: { activated: ["aomi/hyperliquid/portfolio"] },
      attribution: {},
    });
    expect(drawn(step.chips[0])).toMatchObject({
      label: "Hyperliquid",
      icon: PackageIcon,
    });
  });

  it("does not guess when multiple agents declare the same bare tool", () => {
    const step = interpretToolStep({
      toolName: "lookup",
      attribution: {
        agents: ["one", "two"].map((name) => ({
          agent_id: 1,
          agent: `publisher/${name}`,
          display_name: name,
          metadata: { tool_names: ["lookup"] },
        })),
      },
    });
    expect(step.chips).toEqual([]);
  });

  it("recognizes package activation", () => {
    const step = interpretToolStep({
      toolName: "activate_package",
      result: {
        activated: ["krexa"],
        rejected: [["common_erc20", "token_budget_trim"]],
        applied_scope: "current_serve_cycle",
      },
    });

    expect(step.title).toBe("Activate package");
    expect(labelsFor(step.chips)).toEqual(["Krexa"]);
    expect(step.chips[0].title).toBe("Package: Krexa");
    expect(drawn(step.chips[0])?.icon).toBe(getSkillIcon("krexa"));
    expect(drawn(step.chips[0])?.icon).not.toBe(PuzzleIcon);
    expect(step.chips[0].icon).not.toBe(step.icon);
    expect(step.failed).toBe(false);
  });

  it("uses the display name for LI.FI package activation", () => {
    const step = interpretToolStep({
      toolName: "activate_package",
      result: {
        activated: ["common_erc20", "lifi_swap"],
        applied_scope: "current_serve_cycle",
      },
    });

    expect(step.title).toBe("Activate package");
    expect(labelsFor(step.chips)).toEqual(["ERC20", "LI.FI"]);
    expect(drawn(step.chips[0])?.icon).toBe(getSkillIcon("common_erc20"));
    // LI.FI is a package now: it draws its own icon, never a TS mark.
    expect(drawn(step.chips[1])?.icon).toBe(PuzzleIcon);
  });

  it("shows active packages on a check without an empty placeholder badge", () => {
    const step = interpretToolStep({
      toolName: "activate_package",
      result: {
        activated: [],
        rejected: [],
        applied_scope: "thread",
        active: ["aave", "common_erc20", "lifi_swap"],
      },
    });

    expect(step.title).toBe("Check active packages");
    expect(labelsFor(step.chips)).toEqual(["Aave", "ERC20", "LI.FI"]);
    expect(drawn(step.chips[1])?.icon).toBe(getSkillIcon("common_erc20"));
    expect(step.failed).toBe(false);

    const noActivePackages = interpretToolStep({
      toolName: "activate_package",
      result: { activated: [], active: [] },
    });
    expect(noActivePackages.title).toBe("Check active packages");
    expect(noActivePackages.chips).toEqual([]);
  });
});
