import { describe, expect, it } from "vitest";
import { identifierUrl, toolIdentifierReferences } from "./explorer-links";
import { remarkOnchainIdentifiers } from "./remark-onchain-identifiers";

const ADDRESS = `0x${"a".repeat(40)}`;
const TX = `0x${"b".repeat(64)}`;

describe("reply identifier provenance", () => {
  it("does not turn numeric amounts into block links", () => {
    const refs = toolIdentifierReferences([
      { type: "tool-call", result: { chain_id: 8453, block_number: 1 } },
    ]);
    const tree = {
      type: "root",
      children: [
        { type: "text", value: "1 ETH and 1 wallet" },
        { type: "inlineCode", value: "1" },
      ],
    };
    remarkOnchainIdentifiers(refs)(tree);
    expect(tree.children.map((node) => node.type)).toEqual([
      "text",
      "inlineCode",
    ]);
  });
  it("links only the chain and type supplied by this reply's tool result", () => {
    const refs = toolIdentifierReferences([
      {
        type: "tool-call",
        args: { chain_id: 1 },
        result: { chain_id: 8453, token_address: ADDRESS },
      },
    ]);
    expect(refs).toHaveLength(1);
    expect(identifierUrl(refs[0])).toBe(
      `https://basescan.org/token/${ADDRESS}`,
    );
    expect(toolIdentifierReferences([{ type: "text", text: ADDRESS }])).toEqual(
      [],
    );
    expect(
      toolIdentifierReferences([
        { type: "tool-call", args: { chain_id: 1, address: ADDRESS } },
      ]),
    ).toEqual([]);
  });
  it("keeps unknown chains, pools, local receipts and ambiguous references as text", () => {
    const refs = toolIdentifierReferences([
      {
        type: "tool-call",
        result: {
          chain_id: 8453,
          address: ADDRESS,
          nested: { chain_id: null, token_address: ADDRESS },
          transaction_hash: TX,
        },
      },
    ]);
    expect(refs).toHaveLength(1);
    expect(
      identifierUrl({
        identifier: ADDRESS,
        chain: 31337,
        kind: "address",
        provenance: "research",
      }),
    ).toBeNull();
    expect(
      identifierUrl({
        identifier: ADDRESS,
        chain: 8453,
        kind: "pool",
        provenance: "research",
      }),
    ).toBeNull();
    expect(
      identifierUrl({
        identifier: TX,
        chain: 8453,
        kind: "tx",
        provenance: "simulation",
      }),
    ).toBeNull();
    const tree = { type: "root", children: [{ type: "text", value: ADDRESS }] };
    remarkOnchainIdentifiers([...refs, { ...refs[0], kind: "token" }])(tree);
    expect(tree.children[0].type).toBe("text");
  });
  it("requires public transaction provenance and preserves authored/code-block links", () => {
    const refs = toolIdentifierReferences([
      {
        type: "tool-call",
        result: {
          chain_id: 8453,
          transaction_hash: TX,
          provenance: "research",
          public: true,
        },
      },
    ]);
    expect(identifierUrl(refs[0])).toBe(`https://basescan.org/tx/${TX}`);
    const tree = {
      type: "root",
      children: [
        {
          type: "link",
          url: "https://example.com",
          children: [{ type: "text", value: TX }],
        },
        { type: "code", value: TX },
        { type: "text", value: TX },
      ],
    };
    remarkOnchainIdentifiers(refs)(tree);
    expect(tree.children[0].url).toBe("https://example.com");
    expect(tree.children[1].type).toBe("code");
    expect(tree.children[2].url).toBe(`https://basescan.org/tx/${TX}`);
  });
});
