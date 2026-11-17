import { afterEach, describe, expect, it } from "vitest";
import {
  askLines,
  groupPackages,
  markNoticeSeen,
  matches,
  noticeSeen,
  reasonText,
} from "./model";
import {
  AGENT_LISTED,
  NEEDS_KEY,
  NOT_VERIFIED,
  VERIFIED,
  packageRow,
} from "@/test/package-fixtures";

afterEach(() => localStorage.clear());

describe("library model", () => {
  it("groups agent-listed, then verified, then the rest, one row per package", () => {
    const verifiedAndListed = { ...AGENT_LISTED, verified: true };
    const groups = groupPackages([
      NOT_VERIFIED,
      VERIFIED,
      verifiedAndListed,
      { ...verifiedAndListed },
    ]);
    expect(
      groups.map(({ group, rows }) => [group, rows.map((row) => row.id)]),
    ).toEqual([
      ["agent", ["aomi/aave"]],
      ["verified", ["aomi/jupiter"]],
      ["other", ["arixoneth/hoodit-trade"]],
    ]);
    expect(reasonText(AGENT_LISTED, "Aomi")).toBe(
      "Aomi uses it, so it stays on.",
    );
    expect(reasonText(NOT_VERIFIED, "Aomi")).toMatch(/Off until you switch/);
  });

  it("filters by section, family and search", () => {
    const rows = [AGENT_LISTED, VERIFIED, NOT_VERIFIED, NEEDS_KEY];
    const ids = (filter: Parameters<typeof matches>[1]) =>
      rows.filter((row) => matches(row, filter)).map((row) => row.package_id);
    const base = { family: null, query: "" };
    expect(ids({ ...base, view: "on" })).toEqual([9001, 9003, 9020]);
    expect(ids({ ...base, view: "not_verified" })).toEqual([9010]);
    expect(ids({ ...base, view: "connect" })).toEqual([9020]);
    expect(ids({ ...base, view: "all", family: "svm" })).toEqual([9003]);
    // Search looks across every section, including package skills.
    expect(ids({ view: "connect", family: null, query: "JUPITER" })).toEqual([
      9003,
    ]);
  });

  it("says what the envelope can ask for in plain words", () => {
    expect(askLines(NOT_VERIFIED.envelope)).toEqual([
      "Approve transactions on EVM chains",
      "Sign Order on Base",
    ]);
  });

  it("remembers the notice per device, package and envelope hash", () => {
    expect(noticeSeen(NOT_VERIFIED)).toBe(false);
    markNoticeSeen(NOT_VERIFIED);
    expect(noticeSeen(NOT_VERIFIED)).toBe(true);
    const wider = packageRow({
      ...NOT_VERIFIED,
      envelope: { ...NOT_VERIFIED.envelope, hash: "sha256:env10" },
    });
    expect(noticeSeen(wider)).toBe(false);
    expect(noticeSeen({ ...NOT_VERIFIED, package_id: 1 })).toBe(false);
  });
});
