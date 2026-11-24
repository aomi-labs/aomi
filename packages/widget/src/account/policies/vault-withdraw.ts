// The owner redeems a short-lived, single-use delegation from their vault.
import { DELEGATION_MANAGER } from "@aomi-labs/client";
import {
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  isAddress,
  parseAbi,
  parseAbiParameters,
} from "viem";

type Hex = `0x${string}`;

// Delegation Framework v1.3.0, the same addresses on every chain below
// (`delegation.rs`, checked on Base and Ethereum mainnet).
export { DELEGATION_MANAGER };
export const TIMESTAMP_ENFORCER = "0x1046bb45c8d673d4ea75321280db34899413c069";
export const LIMITED_CALLS_ENFORCER =
  "0x04658b29f6b82ed55274221a06fc97d318e25416";
export const ROOT_AUTHORITY: Hex = `0x${"ff".repeat(32)}`;
export const WITHDRAW_CHAINS: readonly number[] = [1, 10, 8453, 84532];
export const MAX_WITHDRAW_WINDOW = 3_600;

const UINT256_MAX = BigInt(2) ** BigInt(256) - BigInt(1);
const HALF_ORDER = BigInt(
  "0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0",
);

const ABI = parseAbi([
  "function redeemDelegations(bytes[] _permissionContexts, bytes32[] _modes, bytes[] _executionCallDatas)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);
const DELEGATIONS = parseAbiParameters(
  "(address delegate, address delegator, bytes32 authority, (address enforcer, bytes terms, bytes args)[] caveats, uint256 salt, bytes signature)[]",
);
/** ERC-7579 single call, revert on failure: the mode the enforcers accept. */
const MODE_SINGLE_DEFAULT: Hex = `0x${"00".repeat(32)}`;

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
} as const;

export type WithdrawAsset = { erc20: string } | { native: true };

export type WithdrawTypedData = {
  types: typeof TYPES;
  primaryType: "Delegation";
  domain: {
    name: "DelegationManager";
    version: "1";
    chainId: number;
    verifyingContract: typeof DELEGATION_MANAGER;
  };
  message: WithdrawDelegation;
};

export type WithdrawDelegation = {
  delegate: Hex;
  delegator: Hex;
  authority: Hex;
  caveats: { enforcer: Hex; terms: Hex }[];
  /** Decimal string: a uint256 does not fit a JSON number. */
  salt: string;
};

export type WithdrawTransaction = {
  to: typeof DELEGATION_MANAGER;
  data: Hex;
  value: "0x0";
};

const ZERO = `0x${"0".repeat(40)}`;
const refuse = (message: string) => new Error(message);

function address(value: unknown, what: string): Hex {
  if (
    typeof value !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/.test(value) ||
    !isAddress(value)
  )
    throw refuse(`${what} is not a 0x address.`);
  return value.toLowerCase() as Hex;
}

function uint(value: unknown, what: string, { positive = false } = {}): bigint {
  let found: bigint;
  if (typeof value === "bigint") found = value;
  else if (typeof value === "number" && Number.isSafeInteger(value))
    found = BigInt(value);
  else if (typeof value === "string" && /^[0-9]+$/.test(value))
    found = BigInt(value);
  else throw refuse(`${what} is not a whole number.`);
  if (found < BigInt(0) || found > UINT256_MAX)
    throw refuse(`${what} is out of range.`);
  if (positive && found === BigInt(0))
    throw refuse(`${what} must be above zero.`);
  return found;
}

const word = (value: bigint) => value.toString(16).padStart(64, "0");

/** `uint128(after) ‖ uint128(before)`, both exclusive; zero disables a side. */
export const timestampTerms = (after: bigint, before: bigint): Hex =>
  `0x${word(after).slice(32)}${word(before).slice(32)}`;

export const limitedCallsTerms = (limit: bigint): Hex => `0x${word(limit)}`;

const nowSeconds = () => Math.floor(Date.now() / 1000);

export function freshSalt(
  random: (bytes: Uint8Array) => Uint8Array = (bytes) =>
    globalThis.crypto.getRandomValues(bytes),
): string {
  const bytes = random(new Uint8Array(32));
  return BigInt(
    `0x${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`,
  ).toString();
}

export function withdrawTypedData({
  chainId,
  vault,
  owner,
  salt,
  deadline,
  now = nowSeconds(),
}: {
  chainId: number;
  vault: string;
  owner: string;
  salt: string | bigint;
  deadline: number;
  now?: number;
}): WithdrawTypedData {
  if (!Number.isSafeInteger(chainId) || !WITHDRAW_CHAINS.includes(chainId))
    throw refuse("A withdrawal is not available on this network yet.");
  const from = address(vault, "The vault");
  const to = address(owner, "The owner");
  if (from === to)
    throw refuse("The vault and the owner must be different addresses.");
  if (!Number.isSafeInteger(deadline) || deadline <= now)
    throw refuse("The withdrawal's deadline is not in the future.");
  if (deadline > now + MAX_WITHDRAW_WINDOW)
    throw refuse("The withdrawal's deadline is more than an hour away.");
  const salted = uint(salt, "The salt");
  return {
    types: TYPES,
    primaryType: "Delegation",
    domain: {
      name: "DelegationManager",
      version: "1",
      chainId,
      verifyingContract: DELEGATION_MANAGER,
    },
    message: {
      delegate: to,
      delegator: from,
      authority: ROOT_AUTHORITY,
      caveats: [
        {
          enforcer: TIMESTAMP_ENFORCER,
          terms: timestampTerms(BigInt(0), BigInt(deadline) + BigInt(1)),
        },
        {
          enforcer: LIMITED_CALLS_ENFORCER,
          terms: limitedCallsTerms(BigInt(1)),
        },
      ],
      salt: salted.toString(),
    },
  };
}

export function withdrawSigningArgs(data: WithdrawTypedData) {
  const { EIP712Domain: _domain, ...types } = data.types;
  return {
    domain: data.domain,
    types,
    primaryType: data.primaryType,
    message: { ...data.message, salt: BigInt(data.message.salt) },
  };
}

/** The signature as the vault takes it: 65 bytes, `v` 27 or 28, a low `s`. */
function vaultSignature(value: unknown): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(value))
    throw refuse("The signature is not 65 bytes of hex.");
  const bytes = value.slice(2).toLowerCase();
  if (BigInt(`0x${bytes.slice(64, 128)}`) > HALF_ORDER)
    throw refuse("The signature cannot be used: its s is too high.");
  const v = parseInt(bytes.slice(128), 16);
  if (v !== 0 && v !== 1 && v !== 27 && v !== 28)
    throw refuse("The signature's recovery byte is not one a wallet gives.");
  return `0x${bytes.slice(0, 128)}${(v === 0 || v === 27 ? 27 : 28).toString(16)}`;
}

function checkedDelegation(
  delegation: WithdrawDelegation,
  owner: string,
  now: number,
) {
  const delegate = address(delegation?.delegate, "The delegate");
  if (delegate !== owner)
    throw refuse("The delegation is not for the owner's own account.");
  const delegator = address(delegation.delegator, "The vault");
  if (delegator === owner)
    throw refuse("The vault and the owner must be different addresses.");
  if (String(delegation.authority).toLowerCase() !== ROOT_AUTHORITY)
    throw refuse("The delegation's authority is not the vault's own.");
  const caveats = delegation.caveats;
  if (!Array.isArray(caveats) || caveats.length !== 2)
    throw refuse("The delegation must carry exactly its two caveats.");
  const [time, calls] = caveats as [
    { enforcer: string; terms: string },
    { enforcer: string; terms: string },
  ];
  if (
    String(time?.enforcer).toLowerCase() !== TIMESTAMP_ENFORCER ||
    !/^0x0{32}[0-9a-f]{32}$/i.test(String(time?.terms))
  )
    throw refuse(
      "The delegation's time limit is not one this withdrawal makes.",
    );
  if (
    String(calls?.enforcer).toLowerCase() !== LIMITED_CALLS_ENFORCER ||
    String(calls?.terms).toLowerCase() !== limitedCallsTerms(BigInt(1))
  )
    throw refuse("The delegation must be usable exactly once.");
  const before = BigInt(`0x${time.terms.slice(34)}`);
  if (before <= BigInt(now) + BigInt(1))
    throw refuse("The withdrawal's time has passed. Sign it again.");
  if (before > BigInt(now) + BigInt(MAX_WITHDRAW_WINDOW) + BigInt(1))
    throw refuse("The withdrawal's deadline is more than an hour away.");
  return {
    delegate,
    delegator,
    authority: ROOT_AUTHORITY as Hex,
    caveats: [
      {
        enforcer: TIMESTAMP_ENFORCER as Hex,
        terms: time.terms.toLowerCase() as Hex,
        args: "0x" as Hex,
      },
      {
        enforcer: LIMITED_CALLS_ENFORCER as Hex,
        terms: calls.terms.toLowerCase() as Hex,
        args: "0x" as Hex,
      },
    ],
    salt: uint(delegation.salt, "The salt"),
  };
}

export function withdrawCalldata({
  delegation,
  signature,
  asset,
  owner,
  amount,
  now = nowSeconds(),
}: {
  delegation: WithdrawDelegation;
  signature: string;
  asset: WithdrawAsset;
  owner: string;
  amount: bigint | string | number;
  now?: number;
}): WithdrawTransaction {
  const to = address(owner, "The owner");
  const moved = uint(amount, "The amount", { positive: true });
  const checked = checkedDelegation(delegation, to, now);
  const signed = vaultSignature(signature);
  const token = "erc20" in asset ? address(asset.erc20, "The token") : null;
  if (token === ZERO) throw refuse("The token is not a contract address.");
  const execution =
    token !== null
      ? encodePacked(
          ["address", "uint256", "bytes"],
          [
            token as Hex,
            BigInt(0),
            encodeFunctionData({
              abi: ABI,
              functionName: "transfer",
              args: [to as Hex, moved],
            }),
          ],
        )
      : "native" in asset && asset.native === true
        ? encodePacked(
            ["address", "uint256", "bytes"],
            [to as Hex, moved, "0x"],
          )
        : (() => {
            throw refuse("Name an ERC-20 token or the native coin.");
          })();
  const context = encodeAbiParameters(DELEGATIONS, [
    [{ ...checked, signature: signed }],
  ]);
  return {
    to: DELEGATION_MANAGER,
    data: encodeFunctionData({
      abi: ABI,
      functionName: "redeemDelegations",
      args: [[context], [MODE_SINGLE_DEFAULT], [execution]],
    }).toLowerCase() as Hex,
    value: "0x0",
  };
}
