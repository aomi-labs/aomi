import { afterEach, describe, expect, it } from "vitest";
import {
  chainPills,
  groupPackages,
  markNoticeSeen,
  matches,
  noticeSeen,
  shortDigest,
  walletLines,
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
  it("groups agent-listed, private, verified, then the rest, one row per package", () => {
    const verifiedAndListed = { ...AGENT_LISTED, verified: true };
    const groups = groupPackages([
      NOT_VERIFIED,
      VERIFIED,
      verifiedAndListed,
      { ...verifiedAndListed },
      { ...VERIFIED, package_id: 9100, id: "acme/secret", listed: false },
    ]);
    expect(
      groups.map(({ group, rows }) => [group, rows.map((row) => row.id)]),
    ).toEqual([
      ["agent", ["aomi/aave"]],
      ["private", ["acme/secret"]],
      ["verified", ["aomi/jupiter"]],
      ["other", ["arixoneth/hoodit-trade"]],
    ]);
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

  it("says what the package asks of the wallet in plain words", () => {
    const lines = (row: Parameters<typeof walletLines>[0]) =>
      walletLines(row).map(({ title, detail }) => [title, detail]);
    expect(lines(NOT_VERIFIED)).toEqual([
      ["Prepares EVM transactions", "You approve each one in your wallet."],
      ["Asks you to sign typed data", "You sign each one in your wallet."],
    ]);
    expect(
      lines(
        packageRow({
          guards: ["svm/jupiter"],
          envelope: {
            ...VERIFIED.envelope,
            transactions: ["evm", "svm"],
            signatures: [
              { kind: "svm-message", domains: [], primary_types: [] },
            ],
          },
        }),
      ),
    ).toEqual([
      [
        "Prepares EVM and Solana transactions",
        "You approve each one in your wallet.",
      ],
      ["Asks you to sign a message", "You sign each one in your wallet."],
      ["Checked by a guard before you approve", "svm/jupiter"],
    ]);
    const quiet = packageRow({
      envelope: { ...VERIFIED.envelope, transactions: [], signatures: [] },
    });
    expect(walletLines(quiet)).toEqual([]);
  });

  it("names chains from signature domains, else the family", () => {
    const labels = (row: Parameters<typeof chainPills>[0]) =>
      chainPills(row).map((pill) => pill.label);
    expect(labels(NOT_VERIFIED)).toEqual(["Base"]);
    expect(labels(VERIFIED)).toEqual(["Solana"]);
    const zerox = packageRow({
      families: ["evm"],
      envelope: {
        ...VERIFIED.envelope,
        signatures: [
          {
            kind: "evm-typed-data",
            domains: [1, 56, 8453, 1].map((chain_id) => ({
              chain_id,
              verifying_contract: "0x22",
            })),
            primary_types: ["PermitTransferFrom"],
          },
        ],
      },
    });
    expect(labels(zerox)).toEqual(["Ethereum", "BNB Chain", "Base"]);
    expect(chainPills(zerox)[1]!.icon).toBeUndefined();
    // A guest's public row has families only.
    expect(
      labels({
        id: "aomi/zerox",
        display_name: "0x",
        description: "",
        icon_url: null,
        families: ["evm"],
        tool_count: 0,
        skills: [],
        verified: true,
      }),
    ).toEqual(["EVM"]);
  });

  it("shortens a release digest", () => {
    expect(shortDigest("sha256:7c21deadbeef9a")).toBe("7c21…9a");
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
