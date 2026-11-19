import { describe, expect, it } from "vitest";
import { hashTypedData } from "viem";
import type { AomiRulesTypedData } from "@aomi-labs/client";
import { signableTypedData } from "./policy-enforcement";

/**
 * The typed data the backend's MetaMask provider hands the owner's wallet,
 * run through the converter the wallet signs with, must hash to the digest the
 * backend verifies against. The shape below is what `typed_data` in
 * `aomi/crates/sign/src/aa/delegation.rs` emits (chain id a JSON number, salt
 * a decimal string, caveats without `args`); the digests come from the real
 * deployed contracts on a Base fork (`tests/fixtures/delegation/vectors.json`
 * in the backend repo).
 */
const DOMAIN = {
  name: "DelegationManager",
  version: "1",
  chainId: 8453,
  verifyingContract: "0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3",
};

const TYPES = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
  Delegation: [
    { name: "delegate", type: "address" },
    { name: "delegator", type: "address" },
    { name: "authority", type: "bytes32" },
    { name: "caveats", type: "Caveat[]" },
    { name: "salt", type: "uint256" },
  ],
  Caveat: [
    { name: "enforcer", type: "address" },
    { name: "terms", type: "bytes" },
  ],
};

const CASES: {
  name: string;
  message: Record<string, unknown>;
  digest: string;
}[] = [
  {
    name: "erc20",
    message: {
      delegate: "0x5bEC442D21B8Ad1B8b58C93E7800bfB4974008E6",
      delegator: "0xf140E63CD8cFd832980b7214C6394F0974112b3d",
      authority:
        "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      caveats: [
        {
          enforcer: "0xf100b0819427117EcF76Ed94B358B1A5b5C6D2Fc",
          terms:
            "0x833589fcd6edb6e08f4c7c32d4f71b54bda029130000000000000000000000000000000000000000000000000000000000989680",
        },
        {
          enforcer: "0xc2b0d624c1c4319760C96503BA27C347F3260f55",
          terms:
            "0x000000000000000000000000000000000000000000000000000000000000000400000000000000000000000062b9c04b61f4b371bd0bc88e0db8a38df5d72bd4",
        },
        {
          enforcer: "0x92Bf12322527cAA612fd31a0e810472BBB106A8F",
          terms:
            "0x0000000000000000000000000000000000000000000000000000000000000000",
        },
      ],
      salt: "1",
    },
    digest:
      "0x9db75c27c7ddc6b9d19a402cbc84f4b3c50232c6a60da0c60389f479b390e2ec",
  },
  {
    name: "erc20Timed",
    message: {
      delegate: "0x5bEC442D21B8Ad1B8b58C93E7800bfB4974008E6",
      delegator: "0xf140E63CD8cFd832980b7214C6394F0974112b3d",
      authority:
        "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      caveats: [
        {
          enforcer: "0xf100b0819427117EcF76Ed94B358B1A5b5C6D2Fc",
          terms:
            "0x833589fcd6edb6e08f4c7c32d4f71b54bda029130000000000000000000000000000000000000000000000000000000000989680",
        },
        {
          enforcer: "0xc2b0d624c1c4319760C96503BA27C347F3260f55",
          terms:
            "0x000000000000000000000000000000000000000000000000000000000000000400000000000000000000000062b9c04b61f4b371bd0bc88e0db8a38df5d72bd4",
        },
        {
          enforcer: "0x92Bf12322527cAA612fd31a0e810472BBB106A8F",
          terms:
            "0x0000000000000000000000000000000000000000000000000000000000000000",
        },
        {
          enforcer: "0x1046bb45C8d673d4ea75321280DB34899413c069",
          terms:
            "0x0000000000000000000000000000000000000000000000000000000077359401",
        },
      ],
      salt: "6",
    },
    digest:
      "0x65a7ceaa438cba1fe2398f262efddda4e481d67557cb3a2ad958bac156f79803",
  },
  {
    name: "native",
    message: {
      delegate: "0x5bEC442D21B8Ad1B8b58C93E7800bfB4974008E6",
      delegator: "0xf140E63CD8cFd832980b7214C6394F0974112b3d",
      authority:
        "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      caveats: [
        {
          enforcer: "0xF71af580b9c3078fbc2BBF16FbB8EEd82b330320",
          terms:
            "0x000000000000000000000000000000000000000000000000002386f26fc10000",
        },
        {
          enforcer: "0x7F20f61b1f09b08D970938F6fa563634d65c4EeB",
          terms: "0x62b9c04b61f4b371bd0bc88e0db8a38df5d72bd4",
        },
        {
          enforcer: "0x99F2e9bF15ce5eC84685604836F71aB835DBBdED",
          terms: "0x",
        },
      ],
      salt: "3",
    },
    digest:
      "0x4a88abbc07a573e2bbbd2af2709293acdc396c4a79f097e42e2b92d2612a1dc2",
  },
  {
    name: "nativeTimed",
    message: {
      delegate: "0x5bEC442D21B8Ad1B8b58C93E7800bfB4974008E6",
      delegator: "0xf140E63CD8cFd832980b7214C6394F0974112b3d",
      authority:
        "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      caveats: [
        {
          enforcer: "0xF71af580b9c3078fbc2BBF16FbB8EEd82b330320",
          terms:
            "0x000000000000000000000000000000000000000000000000002386f26fc10000",
        },
        {
          enforcer: "0x7F20f61b1f09b08D970938F6fa563634d65c4EeB",
          terms: "0x62b9c04b61f4b371bd0bc88e0db8a38df5d72bd4",
        },
        {
          enforcer: "0x99F2e9bF15ce5eC84685604836F71aB835DBBdED",
          terms: "0x",
        },
        {
          enforcer: "0x1046bb45C8d673d4ea75321280DB34899413c069",
          terms:
            "0x0000000000000000000000000000000000000000000000000000000077359401",
        },
      ],
      salt: "7",
    },
    digest:
      "0x7df54ab18d21e79097cc8cdad5f94474d2f5085426607d5fdb51d249749d09b7",
  },
  {
    name: "revokeErc20Salt2",
    message: {
      delegate: "0x47b36363F9f315ff5ceB4F89B3E5cC89AC1F4749",
      delegator: "0xf140E63CD8cFd832980b7214C6394F0974112b3d",
      authority:
        "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      caveats: [
        {
          enforcer: "0x146713078D39eCC1F5338309c28405ccf85Abfbb",
          terms:
            "0xdb9b1e94b5b69df7e401ddbede43491141047db300000000000000000000000000000000000000000000000000000000000000004993404700000000000000000000000000000000000000000000000000000000000000200000000000000000000000005bec442d21b8ad1b8b58c93e7800bfb4974008e6000000000000000000000000f140e63cd8cfd832980b7214c6394f0974112b3dffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000003c00000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000220000000000000000000000000f100b0819427117ecf76ed94b358b1a5b5c6d2fc000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000034833589fcd6edb6e08f4c7c32d4f71b54bda0291300000000000000000000000000000000000000000000000000000000009896800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c2b0d624c1c4319760c96503ba27c347f3260f55000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000400000000000000000000000062b9c04b61f4b371bd0bc88e0db8a38df5d72bd4000000000000000000000000000000000000000000000000000000000000000000000000000000000000000092bf12322527caa612fd31a0e810472bbb106a8f000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
        },
        {
          enforcer: "0x04658B29F6b82ed55274221a06Fc97D318E25416",
          terms:
            "0x0000000000000000000000000000000000000000000000000000000000000001",
        },
      ],
      salt: "100",
    },
    digest:
      "0x0f28c40c94aa91db2f937497f3332776a40767950eb6526f47b7b6aebce772da",
  },
];

describe("backend typed data against the wallet's signing digest", () => {
  it.each(CASES)("$name hashes to the digest the backend checks", (entry) => {
    const data = {
      types: TYPES,
      primaryType: "Delegation",
      domain: DOMAIN,
      message: entry.message,
    } as unknown as AomiRulesTypedData;
    const signable = signableTypedData(data, DOMAIN.chainId);
    const { EIP712Domain: _domain, ...types } = signable.types as Record<
      string,
      readonly { name: string; type: string }[]
    >;
    expect(
      hashTypedData({
        domain: signable.domain,
        types,
        primaryType: "Delegation",
        message: signable.message,
      } as unknown as Parameters<typeof hashTypedData>[0]),
    ).toBe(entry.digest);
  });

  it("refuses data for another chain", () => {
    const data = {
      types: TYPES,
      primaryType: "Delegation",
      domain: DOMAIN,
      message: CASES[0]!.message,
    } as unknown as AomiRulesTypedData;
    expect(() => signableTypedData(data, 1)).toThrow(/another chain/);
  });
});
