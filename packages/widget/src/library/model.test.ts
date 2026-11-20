import { afterEach, describe, expect, it } from "vitest";
import {
  chainItem,
  groupPackages,
  markNoticeSeen,
  matches,
  networkItems,
  noticeSeen,
  shortDigest,
  tagItems,
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

  it("filters by section, network, tag and search", () => {
    const rows = [AGENT_LISTED, VERIFIED, NOT_VERIFIED, NEEDS_KEY];
    const ids = (filter: Parameters<typeof matches>[1]) =>
      rows.filter((row) => matches(row, filter)).map((row) => row.package_id);
    const base = { chain: null, tag: null, query: "" };
    expect(ids({ ...base, view: "on" })).toEqual([9001, 9003, 9020]);
    expect(ids({ ...base, view: "not_verified" })).toEqual([9010]);
    expect(ids({ ...base, view: "connect" })).toEqual([9020]);
    expect(ids({ ...base, view: "all", chain: "solana" })).toEqual([9003]);
    expect(ids({ ...base, view: "all", chain: "base" })).toEqual([9001]);
    expect(ids({ ...base, view: "all", tag: "lending" })).toEqual([9001]);
    expect(
      ids({ ...base, view: "all", chain: "solana", tag: "lending" }),
    ).toEqual([]);
    // Search looks across every section, including package skills.
    expect(ids({ ...base, view: "connect", query: "JUPITER" })).toEqual([9003]);
  });

  it("lists the networks and tags the rows carry, in the Library's order", () => {
    const rows = [VERIFIED, AGENT_LISTED, NOT_VERIFIED, NEEDS_KEY];
    expect(networkItems(rows).map((item) => item.label)).toEqual([
      "Ethereum",
      "Base",
      "Arbitrum",
      "Polygon",
      "Robinhood Chain",
      "Solana",
    ]);
    expect(tagItems(rows).map((item) => item.label)).toEqual([
      "Lending",
      "DEX",
      "Prediction",
    ]);
    expect(networkItems([]).length + tagItems([]).length).toBe(0);
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

  it("names the chains the backend resolved, guessing nothing", () => {
    expect(AGENT_LISTED.chains.map((name) => chainItem(name).label)).toEqual([
      "Ethereum",
      "Base",
      "Arbitrum",
    ]);
    expect(chainItem("solana").icon).toBeDefined();
    expect(chainItem("unifi-testnet")).toEqual({
      id: "unifi-testnet",
      label: "Unifi Testnet",
    });
    expect(chainItem("newchain").label).toBe("newchain");
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
