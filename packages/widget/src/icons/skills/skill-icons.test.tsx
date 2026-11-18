import { describe, expect, it } from "vitest";
import { PuzzleIcon } from "lucide-react";

import { traceIcon } from "@/thread/trace-icons";
import { getSkillIcon, KrexaSkillIcon, normalizeSkillId } from "./skill-icons";

describe("skill icon mapping", () => {
  it("draws the built-in skills' marks, normalizing wire ids", () => {
    expect(normalizeSkillId("  Common-ERC20 ")).toBe("common_erc20");
    expect(getSkillIcon("  Common-ERC20 ")).toBe(getSkillIcon("spl_token"));
    expect(getSkillIcon("krexa")).toBe(KrexaSkillIcon);
    expect(traceIcon("skill:krexa")).toBe(KrexaSkillIcon);
  });

  it("holds no package logo: a package draws its own icon_url", () => {
    for (const id of ["jupiter", "xstocks", "uniswap", "aave", "defillama"]) {
      expect(getSkillIcon(id), id).toBeUndefined();
      expect(traceIcon(`skill:${id}`), id).toBe(PuzzleIcon);
    }
  });

  it("never resolves object prototype keys", () => {
    expect(getSkillIcon("constructor")).toBeUndefined();
    expect(getSkillIcon("toString")).toBeUndefined();
    expect(getSkillIcon("")).toBeUndefined();
  });
});
