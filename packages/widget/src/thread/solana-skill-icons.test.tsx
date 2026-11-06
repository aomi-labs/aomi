import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PuzzleIcon } from "lucide-react";

import {
  getSkillIcon,
  JupiterSkillIcon,
  XStocksSkillIcon,
} from "@/icons/skills/skill-icons";
import { SkillIdentity } from "@/library/library-detail-panel";
import { interpretToolStep } from "./attribution";
import { traceIcon } from "./trace-icons";
import { ToolChipView } from "./tool-chip";

const SOLANA_SKILLS = [
  ["xstocks", "xStocks"],
  ["rwa", "RWA"],
  ["jupiter_lend", "Jupiter Lend"],
  ["meteora", "Meteora"],
  ["jupiter", "Jupiter"],
];

describe("Solana skill artwork across Library and working trace", () => {
  it.each(SOLANA_SKILLS)(
    "uses the same local mark for %s in both views",
    (id, label) => {
      const Icon = getSkillIcon(id);
      expect(Icon).toBeDefined();
      const step = interpretToolStep({
        toolName: "activate_skills",
        result: { activated: [id] },
      });
      const chip = step.chips.find((item) => item.icon === `skill:${id}`);
      expect(chip).toBeDefined();
      expect(traceIcon(chip!.icon!)).toBe(Icon);

      const library = document.createElement("div");
      library.innerHTML = renderToStaticMarkup(
        createElement(SkillIdentity, { skillId: id }),
      );
      const svg = library.querySelector("svg");
      expect(svg?.innerHTML).toBe(
        new DOMParser()
          .parseFromString(
            renderToStaticMarkup(createElement(Icon!)),
            "text/html",
          )
          .querySelector("svg")?.innerHTML,
      );
      expect(svg?.classList.contains("size-5")).toBe(true);
      expect(svg?.getAttribute("aria-hidden")).toBe("true");

      const trace = document.createElement("div");
      trace.innerHTML = renderToStaticMarkup(
        createElement(ToolChipView, { chip: chip! }),
      );
      expect(trace.querySelector(".truncate")?.textContent).toBe(label);
      expect(trace.querySelector("svg")?.innerHTML).toBe(svg?.innerHTML);
      expect(trace.querySelector("svg")?.getAttribute("class")).toContain(
        "size-3.5",
      );
    },
  );

  it("uses the expected brand marks, including normalized IDs", () => {
    expect(getSkillIcon("xstocks")).toBe(XStocksSkillIcon);
    expect(getSkillIcon("jupiter")).toBe(JupiterSkillIcon);
    expect(getSkillIcon(" Jupiter-Lend ")).toBe(JupiterSkillIcon);
    expect(traceIcon("skill:jupiter_lend")).toBe(JupiterSkillIcon);
  });

  it("keeps unknown skill IDs on the neutral fallback", () => {
    expect(getSkillIcon("partner/custom-skill")).toBeUndefined();
    expect(traceIcon("skill:partner/custom-skill")).toBe(PuzzleIcon);
  });
});
