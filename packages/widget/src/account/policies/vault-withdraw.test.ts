import {
  concat,
  decodeAbiParameters,
  decodeFunctionData,
  keccak256,
  pad,
  parseAbi,
  parseAbiParameters,
  stringToHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  DELEGATION_MANAGER,
  MAX_WITHDRAW_WINDOW,
  ROOT_AUTHORITY,
  TIMESTAMP_ENFORCER,
  limitedCallsTerms,
  timestampTerms,
  withdrawCalldata,
  withdrawSigningArgs,
  withdrawTypedData,
} from "./vault-withdraw";

const owner = privateKeyToAccount(
  keccak256(stringToHex("aomi-vault-withdraw-test/owner")),
);
const VAULT = "0xf140e63cd8cfd832980b7214c6394f0974112b3d";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const OTHER = "0x00000000000000000000000000000000000000aa";
const NOW = 1_800_000_000;
const DEADLINE = NOW + 600;
const SALT = "123456789012345678901234567890";
const AMOUNT = BigInt(2_500_000);
const ONCE = `0x${"0".repeat(63)}1`;

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
const fields = (spec: string) =>
  spec.split(" ").map((field) => {
    const [name, type] = field.split(":");
    return { name, type };
  });
const word = (address: string) =>
  pad(address.toLowerCase() as `0x${string}`, { size: 32 });
const uint = (value: bigint | number) =>
  `0x${value.toString(16).padStart(64, "0")}` as `0x${string}`;

describe("the withdraw typed data", () => {
  it("is the backend's grant shape: the manager's domain, the owner as delegate, two caveats", () => {
    expect(typed()).toEqual({
      types: {
        EIP712Domain: fields(
          "name:string version:string chainId:uint256 verifyingContract:address",
        ),
        Delegation: fields(
          "delegate:address delegator:address authority:bytes32 caveats:Caveat[] salt:uint256",
        ),
        Caveat: fields("enforcer:address terms:bytes"),
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
            terms: timestampTerms(BigInt(0), BigInt(DEADLINE + 1)),
          },
          {
            enforcer: "0x04658b29f6b82ed55274221a06fc97d318e25416",
            terms: ONCE,
          },
        ],
        salt: SALT,
      },
    });
  });

  it("writes the Timestamp and LimitedCalls terms as the on-chain vectors do", () => {
    const end = `0x${"0".repeat(56)}77359401`;
    expect(timestampTerms(BigInt(0), BigInt(2_000_000_001))).toBe(end);
    expect(timestampTerms(BigInt(1), BigInt(2))).toBe(
      `0x${"0".repeat(31)}1${"0".repeat(31)}2`,
    );
    expect(limitedCallsTerms(BigInt(1))).toBe(ONCE);
    const { caveats } = typed({ deadline: 2e9, now: 2e9 - 60 }).message;
    expect(caveats.map((caveat) => caveat.terms)).toEqual([end, ONCE]);
  });
});

const REDEEM = parseAbi([
  "function redeemDelegations(bytes[] _permissionContexts, bytes32[] _modes, bytes[] _executionCallDatas)",
]);
const DELEGATIONS = parseAbiParameters(
  "(address delegate, address delegator, bytes32 authority, (address enforcer, bytes terms, bytes args)[] caveats, uint256 salt, bytes signature)[]",
);
type Args = Parameters<typeof withdrawCalldata>[0];
const signed = typed();
const SIG = await owner.signTypedData(withdrawSigningArgs(signed));
const ok: Args = {
  delegation: signed.message,
  signature: SIG,
  asset: { erc20: USDC },
  owner: owner.address,
  amount: AMOUNT,
  now: NOW,
};
const build = (extra: object = {}) =>
  withdrawCalldata({ ...ok, ...extra } as Args);
function parts(data: `0x${string}`) {
  const { functionName, args } = decodeFunctionData({ abi: REDEEM, data });
  const [contexts, modes, executions] = args!;
  const [delegations] = decodeAbiParameters(DELEGATIONS, contexts[0]!);
  return { functionName, contexts, modes, executions, delegations };
}

describe("the redeem transaction", () => {
  it("for an ERC-20 redeems the one signed root delegation into a transfer to the owner, with no value", () => {
    const tx = build();
    expect(tx).toMatchObject({ to: DELEGATION_MANAGER, value: "0x0" });
    const { functionName, contexts, modes, executions, delegations } = parts(
      tx.data,
    );
    expect(functionName).toBe("redeemDelegations");
    expect(contexts).toHaveLength(1);
    expect(modes).toEqual([uint(0)]);
    expect(delegations).toHaveLength(1);
    const [d] = delegations;
    expect(d).toMatchObject({
      delegate: owner.address,
      authority: ROOT_AUTHORITY,
      salt: BigInt(SALT),
      signature: SIG,
    });
    expect(d!.delegator.toLowerCase()).toBe(VAULT);
    expect(
      d!.caveats.map((c) => [c.enforcer.toLowerCase(), c.terms, c.args]),
    ).toEqual(ok.delegation.caveats.map((c) => [c.enforcer, c.terms, "0x"]));
    // abi.encodePacked(token, 0, transfer(owner, amount))
    expect(executions).toEqual([
      concat([USDC, uint(0), "0xa9059cbb", word(owner.address), uint(AMOUNT)]),
    ]);
  });

  it("for the native coin sends the amount to the owner with no calldata and no value", () => {
    const tx = build({ asset: { native: true }, amount: "1000" });
    expect(tx).toMatchObject({ to: DELEGATION_MANAGER, value: "0x0" });
    expect(parts(tx.data).executions).toEqual([
      concat([owner.address.toLowerCase() as `0x${string}`, uint(1000)]),
    ]);
  });

  it.each([
    ["00", "1b"],
    ["01", "1c"],
    ["1b", "1b"],
    ["1C", "1c"],
  ])("writes a signature with v %s as v %s", (v, want) => {
    const tx = build({ signature: `${SIG.slice(0, 130)}${v}` });
    expect(parts(tx.data).delegations[0]!.signature).toBe(
      `${SIG.slice(0, 130)}${want}`,
    );
  });
});

const BAD = ["vitalik.eth", "0x1234", VAULT.slice(2), `${VAULT.slice(0, -1)}z`];
const each = (key: string, values: unknown[]) =>
  values.map((value) => ({ [key]: value }));
const [T, C] = ok.delegation.caveats;
const d = (extra: object) => ({ delegation: { ...ok.delegation, ...extra } });
const cv = (...caveats: object[]) => d({ caveats });
const sig = (tail: string) => ({ signature: `${SIG.slice(0, 130)}${tail}` });
const AMOUNT_ERROR =
  /amount (is not a whole number|must be above zero|is out of range)/;

describe("what is refused", () => {
  it.each<[RegExp, object[]]>([
    [/vault is not a 0x address/, each("vault", [...BAD, undefined])],
    [/owner is not a 0x address/, each("owner", BAD)],
    // A mixed-case address with a wrong checksum.
    [/owner is not/, [{ owner: "0x321D02a5fb29E85d7431D8A0eE70dF9e5E7ebD4f" }]],
    [/must be different/, [{ owner: VAULT }]],
    [/not in the future/, each("deadline", [NOW, NOW - 1, NOW + 0.5, NaN])],
    [/more than an hour/, [{ deadline: NOW + MAX_WITHDRAW_WINDOW + 1 }]],
    [/not available on this network/, each("chainId", [0, 137, 42161, NaN])],
    [
      /salt is not a whole number/,
      each("salt", ["-1", "1.5", "0x1", "", null]),
    ],
    [/salt is out of range/, [{ salt: BigInt(2) ** BigInt(256) }]],
  ])("in the typed data: %s", (message, cases) => {
    for (const extra of cases) refuses(() => typed(extra), message);
  });

  it.each<[RegExp, object[]]>([
    [
      /not for the owner's own account/,
      each("delegate", [OTHER, VAULT]).map(d),
    ],
    [/not for the owner's own account/, [{ owner: OTHER }]],
    [/owner is not a 0x address/, [{ owner: "nobody" }]],
    [/authority is not the vault's own/, [d({ authority: uint(0) })]],
    [/must be different/, [d({ delegator: ok.delegation.delegate })]],
    [/vault is not a 0x address/, [d({ delegator: "nope" })]],
    [/exactly its two caveats/, [cv(), cv(T!), cv(T!, C!, C!)]],
    [/time limit/, [cv(C!, T!), cv({ ...T, enforcer: OTHER }, C!)]],
    // An `after` other than zero, or terms of another length.
    [
      /time limit/,
      [cv({ ...T, terms: `0x${"0".repeat(31)}1${T!.terms.slice(34)}` }, C!)],
    ],
    [/time limit/, [cv({ ...T, terms: "0x00" }, C!)]],
    [/exactly once/, [cv(T!, { ...C, terms: `0x${"0".repeat(63)}2` })]],
    [/exactly once/, [cv(T!, { ...C, enforcer: TIMESTAMP_ENFORCER })]],
    [/salt is not a whole number/, [d({ salt: "-1" })]],
    [/has passed/, each("now", [DEADLINE, DEADLINE + 1])],
    [/more than an hour/, [{ now: NOW - 3_001 }]],
    [
      /65 bytes of hex/,
      each("signature", ["0x", SIG.slice(0, 130), undefined]),
    ],
    [/65 bytes of hex/, [{ signature: `${SIG}00` }]],
    [/recovery byte/, [sig("1d"), sig("02")]],
    [
      /s is too high/,
      [{ signature: `${SIG.slice(0, 66)}${"f".repeat(64)}1b` }],
    ],
    [
      /token is not a 0x address/,
      each("erc20", ["usdc", "0x1234", undefined]).map((asset) => ({ asset })),
    ],
    [/not a contract address/, [{ asset: { erc20: `0x${"0".repeat(40)}` } }]],
    [/ERC-20 token or the native coin/, each("asset", [{}, { native: false }])],
    [AMOUNT_ERROR, each("amount", [0, BigInt(0), "0", -1, "-5", 1.5, "1e6"])],
    [AMOUNT_ERROR, each("amount", ["0x10", "", NaN, 2 ** 60, null])],
    [AMOUNT_ERROR, [{ amount: (BigInt(2) ** BigInt(256)).toString() }]],
  ])("in the redeem: %s", (message, cases) => {
    for (const extra of cases) refuses(() => build(extra), message);
  });
});
