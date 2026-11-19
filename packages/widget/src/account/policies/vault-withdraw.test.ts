import {
  concat,
  decodeAbiParameters,
  decodeFunctionData,
  hashTypedData,
  keccak256,
  pad,
  parseAbi,
  parseAbiParameters,
  recoverTypedDataAddress,
  stringToHex,
  toFunctionSelector,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  DELEGATION_MANAGER,
  LIMITED_CALLS_ENFORCER,
  MAX_WITHDRAW_WINDOW,
  ROOT_AUTHORITY,
  TIMESTAMP_ENFORCER,
  freshSalt,
  limitedCallsTerms,
  timestampTerms,
  withdrawCalldata,
  withdrawSigningArgs,
  withdrawTypedData,
} from "./vault-withdraw";

const OWNER_KEY = keccak256(stringToHex("aomi-vault-withdraw-test/owner"));
const owner = privateKeyToAccount(OWNER_KEY);
const VAULT = "0xf140e63cd8cfd832980b7214c6394f0974112b3d";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const NOW = 1_800_000_000;
const DEADLINE = NOW + 600;
const SALT = "123456789012345678901234567890";

const input = (extra: object = {}) => ({
  chainId: 8453,
  vault: VAULT,
  owner: owner.address,
  salt: SALT,
  deadline: DEADLINE,
  now: NOW,
  ...extra,
});
const typed = (extra: object = {}) => withdrawTypedData(input(extra));
const refuses = (run: () => unknown, message: RegExp) =>
  expect(run).toThrow(message);

describe("the withdraw typed data", () => {
  it("is the backend's grant shape: types with EIP712Domain, the manager's domain, a decimal salt, two caveats", () => {
    expect(typed()).toEqual({
      types: {
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
      },
      primaryType: "Delegation",
      domain: {
        name: "DelegationManager",
        version: "1",
        chainId: 8453,
        verifyingContract: "0xdb9b1e94b5b69df7e401ddbede43491141047db3",
      },
      message: {
        delegate: owner.address.toLowerCase(),
        delegator: VAULT,
        authority: `0x${"ff".repeat(32)}`,
        caveats: [
          {
            enforcer: "0x1046bb45c8d673d4ea75321280db34899413c069",
            // uint128(0) ‖ uint128(deadline + 1)
            terms: `0x${"0".repeat(32)}${(DEADLINE + 1).toString(16).padStart(32, "0")}`,
          },
          {
            enforcer: "0x04658b29f6b82ed55274221a06fc97d318e25416",
            terms: `0x${"0".repeat(63)}1`,
          },
        ],
        salt: SALT,
      },
    });
  });

  it("is the delegation to the owner's own account, with the delegate never anyone else", () => {
    const { message } = typed({ owner: owner.address.toLowerCase() });
    expect(message.delegate).toBe(owner.address.toLowerCase());
    expect(message.delegate).not.toBe(VAULT);
    expect(message.delegate).not.toBe(
      "0x0000000000000000000000000000000000000a11",
    );
  });

  it("writes the Timestamp and LimitedCalls terms byte for byte as the Rust encoders and the on-chain vectors do", () => {
    // vectors.json: Timestamp end 2000000000 => before 2000000001.
    expect(timestampTerms(BigInt(0), BigInt(2_000_000_001))).toBe(
      "0x0000000000000000000000000000000000000000000000000000000077359401",
    );
    // vectors.json: LimitedCalls limit 1.
    expect(limitedCallsTerms(BigInt(1))).toBe(
      "0x0000000000000000000000000000000000000000000000000000000000000001",
    );
    // The same through the typed data, for that deadline.
    const data = typed({ deadline: 2_000_000_000, now: 2_000_000_000 - 60 });
    expect(data.message.caveats.map((caveat) => caveat.terms)).toEqual([
      "0x0000000000000000000000000000000000000000000000000000000077359401",
      "0x0000000000000000000000000000000000000000000000000000000000000001",
    ]);
    // `after` and `before` are two 16-byte halves of one 32-byte word.
    expect(timestampTerms(BigInt(1), BigInt(2))).toBe(
      "0x0000000000000000000000000000000100000000000000000000000000000002",
    );
  });

  it("uses the enforcer addresses of the v1.3.0 table and the root authority", () => {
    expect(TIMESTAMP_ENFORCER).toBe(
      "0x1046bb45c8d673d4ea75321280db34899413c069",
    );
    expect(LIMITED_CALLS_ENFORCER).toBe(
      "0x04658b29f6b82ed55274221a06fc97d318e25416",
    );
    expect(DELEGATION_MANAGER).toBe(
      "0xdb9b1e94b5b69df7e401ddbede43491141047db3",
    );
    expect(ROOT_AUTHORITY).toBe(`0x${"ff".repeat(32)}`);
  });

  it("takes the salt as a bigint or decimal digits, and makes a fresh one of 32 random bytes", () => {
    expect(typed({ salt: BigInt(SALT) }).message.salt).toBe(SALT);
    expect(typed({ salt: 7 }).message.salt).toBe("7");
    const max = BigInt(2) ** BigInt(256) - BigInt(1);
    expect(typed({ salt: max }).message.salt).toBe(max.toString());
    expect(freshSalt(() => new Uint8Array(32).fill(255))).toBe(max.toString());
    expect(freshSalt(() => new Uint8Array(32))).toBe("0");
    expect(freshSalt()).toMatch(/^[0-9]+$/);
    expect(freshSalt()).not.toBe(freshSalt());
  });
});

/**
 * An independent EIP-712 hash of a delegation: keccak256 and ABI words only,
 * none of viem's typed-data code, and the Delegation Framework's own type
 * strings (`delegation.rs`: DELEGATION_TYPE, CAVEAT_TYPE, DOMAIN_TYPE).
 */
const hash = (text: string) => keccak256(stringToHex(text));
const addressWord = (address: string) =>
  pad(address.toLowerCase() as `0x${string}`, { size: 32 });
const uintWord = (value: bigint) =>
  `0x${value.toString(16).padStart(64, "0")}` as `0x${string}`;
function digestOf(
  chainId: number,
  delegation: {
    delegate: string;
    delegator: string;
    authority: string;
    caveats: { enforcer: string; terms: string }[];
    salt: string;
  },
) {
  const caveatHashes = delegation.caveats.map((caveat) =>
    keccak256(
      concat([
        hash("Caveat(address enforcer,bytes terms)"),
        addressWord(caveat.enforcer),
        keccak256(caveat.terms as `0x${string}`),
      ]),
    ),
  );
  const struct = keccak256(
    concat([
      hash(
        "Delegation(address delegate,address delegator,bytes32 authority,Caveat[] caveats,uint256 salt)Caveat(address enforcer,bytes terms)",
      ),
      addressWord(delegation.delegate),
      addressWord(delegation.delegator),
      delegation.authority as `0x${string}`,
      keccak256(concat(caveatHashes)),
      uintWord(BigInt(delegation.salt)),
    ]),
  );
  const domain = keccak256(
    concat([
      hash(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
      ),
      hash("DelegationManager"),
      hash("1"),
      uintWord(BigInt(chainId)),
      addressWord(DELEGATION_MANAGER),
    ]),
  );
  return { struct, digest: keccak256(concat(["0x1901", domain, struct])) };
}

describe("the digest the owner signs", () => {
  it("anchors the independent hasher to the on-chain vectors (vectors.json: the ERC-20 grant, salt 1)", () => {
    const { struct, digest } = digestOf(8453, {
      delegate: "0x5bec442d21b8ad1b8b58c93e7800bfb4974008e6",
      delegator: VAULT,
      authority: ROOT_AUTHORITY,
      caveats: [
        {
          enforcer: "0xf100b0819427117ecf76ed94b358b1a5b5c6d2fc",
          terms:
            "0x833589fcd6edb6e08f4c7c32d4f71b54bda029130000000000000000000000000000000000000000000000000000000000989680",
        },
        {
          enforcer: "0xc2b0d624c1c4319760c96503ba27c347f3260f55",
          terms:
            "0x000000000000000000000000000000000000000000000000000000000000000400000000000000000000000062b9c04b61f4b371bd0bc88e0db8a38df5d72bd4",
        },
        {
          enforcer: "0x92bf12322527caa612fd31a0e810472bbb106a8f",
          terms: `0x${"0".repeat(64)}`,
        },
      ],
      salt: "1",
    });
    // `onchainGetDelegationHash` and `signingDigest` of that delegation.
    expect(struct).toBe(
      "0xddc8984d018c399cf7be59aed178f4e5f1e9a93ff4890f861c4910f52dbdb432",
    );
    expect(digest).toBe(
      "0x9db75c27c7ddc6b9d19a402cbc84f4b3c50232c6a60da0c60389f479b390e2ec",
    );
  });

  it("is, for the withdraw delegation, the same by the independent hasher and by viem over the typed data", () => {
    for (const chainId of [1, 10, 8453, 84532]) {
      const data = typed({ chainId });
      const viem = hashTypedData(withdrawSigningArgs(data));
      expect(viem).toBe(digestOf(chainId, data.message).digest);
    }
    // A different salt or deadline is a different digest.
    const base = hashTypedData(withdrawSigningArgs(typed()));
    expect(hashTypedData(withdrawSigningArgs(typed({ salt: "1" })))).not.toBe(
      base,
    );
    expect(
      hashTypedData(withdrawSigningArgs(typed({ deadline: DEADLINE + 1 }))),
    ).not.toBe(base);
  });

  it("is signed by the owner's key and recovers to the owner", async () => {
    const data = typed();
    const signature = await owner.signTypedData(withdrawSigningArgs(data));
    expect(
      await recoverTypedDataAddress({
        ...withdrawSigningArgs(data),
        signature,
      }),
    ).toBe(owner.address);
  });
});

const REDEEM = parseAbi([
  "function redeemDelegations(bytes[] _permissionContexts, bytes32[] _modes, bytes[] _executionCallDatas)",
]);
const DELEGATIONS = parseAbiParameters(
  "(address delegate, address delegator, bytes32 authority, (address enforcer, bytes terms, bytes args)[] caveats, uint256 salt, bytes signature)[]",
);
const AMOUNT = BigInt(2_500_000);

async function signed() {
  const data = typed();
  return {
    data,
    signature: await owner.signTypedData(withdrawSigningArgs(data)),
  };
}
function parts(data: `0x${string}`) {
  const { functionName, args } = decodeFunctionData({ abi: REDEEM, data });
  const [contexts, modes, executions] = args!;
  const [delegations] = decodeAbiParameters(DELEGATIONS, contexts[0]!);
  return { functionName, contexts, modes, executions, delegations };
}

describe("the redeem transaction", () => {
  it("for an ERC-20 is redeemDelegations with one root delegation and the token's transfer to the owner", async () => {
    const { data, signature } = await signed();
    const tx = withdrawCalldata({
      delegation: data.message,
      signature,
      asset: { erc20: USDC },
      owner: owner.address,
      amount: AMOUNT,
      now: NOW,
    });
    expect(tx.to).toBe(DELEGATION_MANAGER);
    expect(tx.value).toBe("0x0");
    expect(tx.data.slice(0, 10)).toBe(
      toFunctionSelector("redeemDelegations(bytes[],bytes32[],bytes[])"),
    );
    const { functionName, contexts, modes, executions, delegations } = parts(
      tx.data,
    );
    expect(functionName).toBe("redeemDelegations");
    expect(contexts).toHaveLength(1);
    expect(modes).toEqual([`0x${"00".repeat(32)}`]);
    // Exactly one delegation, as the owner signed it, with its signature.
    expect(delegations).toHaveLength(1);
    expect(delegations[0]).toMatchObject({
      delegate: owner.address,
      authority: ROOT_AUTHORITY,
      salt: BigInt(SALT),
      signature,
    });
    expect(delegations[0]!.delegator.toLowerCase()).toBe(VAULT);
    expect(
      delegations[0]!.caveats.map((caveat) => [
        caveat.enforcer.toLowerCase(),
        caveat.terms,
        caveat.args,
      ]),
    ).toEqual(
      data.message.caveats.map((caveat) => [
        caveat.enforcer,
        caveat.terms,
        "0x",
      ]),
    );
    // The one execution: abi.encodePacked(token, 0, transfer(owner, amount)).
    expect(executions).toHaveLength(1);
    expect(executions[0]).toBe(
      concat([
        USDC,
        uintWord(BigInt(0)),
        "0xa9059cbb",
        addressWord(owner.address),
        uintWord(AMOUNT),
      ]),
    );
    expect((executions[0]!.length - 2) / 2).toBe(20 + 32 + 4 + 32 + 32);
  });

  it("for the native coin sends the amount to the owner with no calldata", async () => {
    const { data, signature } = await signed();
    const tx = withdrawCalldata({
      delegation: data.message,
      signature,
      asset: { native: true },
      owner: owner.address,
      amount: "1000000000000000",
      now: NOW,
    });
    const { executions, delegations } = parts(tx.data);
    // abi.encodePacked(owner, value, "") is 52 bytes: no calldata.
    expect(executions[0]).toBe(
      concat([
        owner.address.toLowerCase() as `0x${string}`,
        uintWord(BigInt("1000000000000000")),
      ]),
    );
    expect((executions[0]!.length - 2) / 2).toBe(52);
    expect(delegations[0]!.delegate).toBe(owner.address);
    expect(tx).toMatchObject({ to: DELEGATION_MANAGER, value: "0x0" });
  });

  it("writes the signature as the vault takes it: v as 27 or 28 whichever the wallet gave", async () => {
    const { data, signature } = await signed();
    const raw = signature.slice(0, 130);
    const asBuilt = (v: string) =>
      parts(
        withdrawCalldata({
          delegation: data.message,
          signature: `${raw}${v}`,
          asset: { native: true },
          owner: owner.address,
          amount: 1,
          now: NOW,
        }).data,
      ).delegations[0]!.signature;
    expect(asBuilt("00")).toBe(`${raw}1b`);
    expect(asBuilt("01")).toBe(`${raw}1c`);
    expect(asBuilt("1b")).toBe(`${raw}1b`);
    expect(asBuilt("1C")).toBe(`${raw}1c`);
  });
});

describe("what is refused", () => {
  const ok = async () => {
    const { data, signature } = await signed();
    return {
      delegation: data.message,
      signature,
      asset: { erc20: USDC },
      owner: owner.address,
      amount: AMOUNT,
      now: NOW,
    };
  };
  const build = async (extra: object = {}) =>
    withdrawCalldata({ ...(await ok()), ...extra } as Parameters<
      typeof withdrawCalldata
    >[0]);

  it("an address that is not 0x hex of 20 bytes, for the vault or the owner", () => {
    for (const bad of [
      "vitalik.eth",
      "0x1234",
      "f140e63cd8cfd832980b7214c6394f0974112b3d",
      "0xf140e63cd8cfd832980b7214c6394f0974112b3z",
      "",
    ]) {
      refuses(() => typed({ vault: bad }), /vault is not a 0x address/);
      refuses(() => typed({ owner: bad }), /owner is not a 0x address/);
    }
    refuses(() => typed({ vault: undefined }), /vault is not a 0x address/);
    // A mixed-case address with a wrong checksum is not an address either.
    refuses(
      () => typed({ owner: "0x321D02a5fb29E85d7431D8A0eE70dF9e5E7ebD4f" }),
      /owner is not a 0x address/,
    );
    refuses(() => typed({ owner: VAULT }), /must be different/);
  });

  it("an amount that is zero, negative, fractional or not a number", async () => {
    for (const bad of [
      0,
      BigInt(0),
      "0",
      -1,
      BigInt(-1),
      "-5",
      1.5,
      "1.5",
      "0x10",
      "1e6",
      "",
      NaN,
      Infinity,
      2 ** 60,
      (BigInt(2) ** BigInt(256)).toString(),
      null,
      undefined,
    ]) {
      await expect(build({ amount: bad })).rejects.toThrow(
        /amount (is not a whole number|must be above zero|is out of range)/,
      );
    }
    // A big exact amount is fine as a bigint or digits.
    await expect(
      build({ amount: BigInt(2) ** BigInt(255) }),
    ).resolves.toBeTruthy();
  });

  it("a deadline that is not in the future, or is more than an hour out", () => {
    refuses(() => typed({ deadline: NOW }), /not in the future/);
    refuses(() => typed({ deadline: NOW - 1 }), /not in the future/);
    refuses(() => typed({ deadline: NOW + 0.5 }), /not in the future/);
    refuses(() => typed({ deadline: Number.NaN }), /not in the future/);
    refuses(
      () => typed({ deadline: NOW + MAX_WITHDRAW_WINDOW + 1 }),
      /more than an hour/,
    );
    // The edges: one second ahead, and exactly an hour.
    expect(typed({ deadline: NOW + 1 }).message.caveats).toHaveLength(2);
    expect(
      typed({ deadline: NOW + MAX_WITHDRAW_WINDOW }).message.caveats,
    ).toHaveLength(2);
    // The real clock when `now` is left out.
    const soon = Math.floor(Date.now() / 1000) + 600;
    expect(
      withdrawTypedData({
        ...input(),
        now: undefined,
        deadline: soon,
      }).message.caveats[0]!.terms.endsWith((soon + 1).toString(16)),
    ).toBe(true);
    refuses(
      () =>
        withdrawTypedData({ ...input(), now: undefined, deadline: soon - 700 }),
      /not in the future/,
    );
  });

  it("a chain with no pinned manager", () => {
    for (const chainId of [0, 5, 137, 42161, 31337, -1, 8453.5, Number.NaN]) {
      refuses(() => typed({ chainId }), /not available on this network/);
    }
    for (const chainId of [1, 10, 8453, 84532])
      expect(typed({ chainId }).domain.chainId).toBe(chainId);
  });

  it("a salt that is not a uint256", () => {
    for (const salt of ["-1", "1.5", "0x1", "", -1, 1.5, "abc", null]) {
      refuses(
        () => typed({ salt }),
        /salt is (not a whole number|out of range)/,
      );
    }
    refuses(
      () => typed({ salt: BigInt(2) ** BigInt(256) }),
      /salt is out of range/,
    );
  });

  it("a delegation whose delegate is not the owner passed in, however it got there", async () => {
    const base = await ok();
    const other = "0x00000000000000000000000000000000000000aa";
    for (const delegate of [
      other,
      VAULT,
      "0x0000000000000000000000000000000000000a11",
    ]) {
      await expect(
        build({ delegation: { ...base.delegation, delegate } }),
      ).rejects.toThrow(/not for the owner's own account/);
    }
    // Nor for another owner than the delegation names.
    await expect(build({ owner: other })).rejects.toThrow(
      /not for the owner's own account/,
    );
    await expect(build({ owner: "nobody" })).rejects.toThrow(
      /owner is not a 0x address/,
    );
  });

  it("a delegation that is not exactly what withdrawTypedData makes", async () => {
    const { delegation } = await ok();
    const [time, calls] = delegation.caveats;
    const bad = (extra: object, message: RegExp) =>
      expect(
        build({ delegation: { ...delegation, ...extra } }),
      ).rejects.toThrow(message);
    await bad(
      { authority: `0x${"00".repeat(32)}` },
      /authority is not the vault's own/,
    );
    await bad({ delegator: delegation.delegate }, /must be different/);
    await bad({ delegator: "nope" }, /vault is not a 0x address/);
    await bad({ caveats: [] }, /exactly its two caveats/);
    await bad({ caveats: [time] }, /exactly its two caveats/);
    await bad({ caveats: [time, calls, calls] }, /exactly its two caveats/);
    await bad({ caveats: [calls, time] }, /time limit/);
    await bad(
      {
        caveats: [
          { ...time!, enforcer: "0x00000000000000000000000000000000000000aa" },
          calls,
        ],
      },
      /time limit/,
    );
    // An `after` other than zero, or terms of another length.
    await bad(
      {
        caveats: [
          { ...time!, terms: `0x${"0".repeat(31)}1${time!.terms.slice(34)}` },
          calls,
        ],
      },
      /time limit/,
    );
    await bad({ caveats: [{ ...time!, terms: "0x00" }, calls] }, /time limit/);
    // Usable more than once, or under another enforcer.
    await bad(
      { caveats: [time, { ...calls!, terms: `0x${"0".repeat(63)}2` }] },
      /exactly once/,
    );
    await bad(
      { caveats: [time, { ...calls!, enforcer: TIMESTAMP_ENFORCER }] },
      /exactly once/,
    );
    await bad({ salt: "-1" }, /salt is not a whole number/);
    // A delegation whose deadline is past, or more than an hour out.
    await expect(build({ now: DEADLINE + 1 })).rejects.toThrow(/has passed/);
    await expect(build({ now: DEADLINE })).rejects.toThrow(/has passed/);
    await expect(build({ now: DEADLINE - 1 })).resolves.toBeTruthy();
    await expect(build({ now: NOW - 3_000 })).resolves.toBeTruthy();
    await expect(build({ now: NOW - 3_001 })).rejects.toThrow(
      /more than an hour/,
    );
  });

  it("a signature that is not 65 bytes, has a high s, or a recovery byte no wallet gives", async () => {
    const { signature } = await ok();
    for (const bad of [
      "",
      "0x",
      "0x1234",
      signature.slice(0, 130),
      `${signature}00`,
      "signature",
      undefined,
    ])
      await expect(build({ signature: bad })).rejects.toThrow(
        /65 bytes of hex/,
      );
    await expect(
      build({ signature: `${signature.slice(0, 130)}1d` }),
    ).rejects.toThrow(/recovery byte/);
    await expect(
      build({ signature: `${signature.slice(0, 130)}02` }),
    ).rejects.toThrow(/recovery byte/);
    const highS = `${signature.slice(0, 66)}${"ff".repeat(32)}${signature.slice(130)}`;
    await expect(build({ signature: highS })).rejects.toThrow(/s is too high/);
  });

  it("a token that is not an address, the zero address, or no asset at all", async () => {
    for (const erc20 of ["usdc", "0x1234", "", undefined])
      await expect(build({ asset: { erc20 } })).rejects.toThrow(
        /token is not a 0x address/,
      );
    await expect(
      build({ asset: { erc20: `0x${"0".repeat(40)}` } }),
    ).rejects.toThrow(/not a contract address/);
    await expect(build({ asset: {} })).rejects.toThrow(
      /ERC-20 token or the native coin/,
    );
    await expect(build({ asset: { native: false } })).rejects.toThrow(
      /ERC-20 token or the native coin/,
    );
  });

  it("never puts a value in the transaction, whatever is withdrawn", async () => {
    const asset = await build({ asset: { native: true }, amount: AMOUNT });
    const token = await build();
    expect(asset.value).toBe("0x0");
    expect(token.value).toBe("0x0");
  });
});
