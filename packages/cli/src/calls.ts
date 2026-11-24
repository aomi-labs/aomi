import {
  decodeAbiParameters,
  encodeAbiParameters,
  parseAbi,
  toFunctionSelector,
  type AbiFunction,
  type Hex,
} from "viem";

/** The calls the terminal reads in full. What a label says of a call is the
 * agent's text or its package's, so calls are read from their bytes. */
const EVM = new Map<string, AbiFunction>(
  parseAbi([
    "function transfer(address to, uint256 amount)",
    "function approve(address spender, uint256 amountOrId)",
    "function transferFrom(address from, address to, uint256 amountOrId)",
    "function safeTransferFrom(address from, address to, uint256 id)",
    "function safeTransferFrom(address from, address to, uint256 id, bytes data)",
    "function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)",
    "function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] amounts, bytes data)",
    "function setApprovalForAll(address operator, bool approved)",
    "function deposit() payable",
    "function withdraw(uint256 amount)",
    "function deposit(uint256 assets, address receiver)",
    "function mint(uint256 shares, address receiver)",
    "function withdraw(uint256 assets, address receiver, address owner)",
    "function redeem(uint256 shares, address receiver, address owner)",
  ]).map((item) => [toFunctionSelector(item), item]),
);

/** `transfer(to: 0x…, amount: 1)`; undefined unless it is all of `data`. */
export function evmCall(data: string): string | undefined {
  const hex = data.toLowerCase();
  const item = EVM.get(hex.slice(0, 10));
  if (!item) return undefined;
  try {
    const body = `0x${hex.slice(10)}` as Hex;
    const args = decodeAbiParameters(item.inputs, body);
    if (encodeAbiParameters(item.inputs, args) !== body) return undefined;
    const shown = item.inputs.map((input, index) => {
      const value: unknown = args[index];
      return `${input.name}: ${Array.isArray(value) ? `[${value.join(", ")}]` : value}`;
    });
    return `${item.name}(${shown.join(", ")})`;
  } catch {
    return undefined;
  }
}

/** Tag, name, accounts in order, and little-endian arguments with their bytes. */
type Layout = [tag: string, name: string, accounts: string, args: string];
const TOKEN: Layout[] = [
  ["03", "transfer", "from to owner", "amount:8"],
  ["04", "approve", "from delegate owner", "amount:8"],
  ["05", "revoke", "from owner", ""],
  ["09", "closeAccount", "account to owner", ""],
  ["0c", "transferChecked", "from mint to owner", "amount:8 decimals:1"],
  ["0d", "approveChecked", "from mint delegate owner", "amount:8 decimals:1"],
  ["11", "syncNative", "account", ""],
];
const CREATE = "payer account owner mint systemProgram tokenProgram";
const SVM: Record<string, Layout[]> = {
  "11111111111111111111111111111111": [
    ["02000000", "transfer", "from to", "lamports:8"],
  ],
  ComputeBudget111111111111111111111111111111: [
    ["02", "setComputeUnitLimit", "", "units:4"],
    ["03", "setComputeUnitPrice", "", "microLamports:8"],
  ],
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: TOKEN,
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: TOKEN,
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: [
    ["", "create", CREATE, ""],
    ["00", "create", CREATE, ""],
    ["01", "createIdempotent", CREATE, ""],
  ],
};

/** One instruction's call and the role of each account; undefined unless
 * it is all of `data`. */
export function svmCall(
  program: string,
  data: Buffer,
): { call: string; roles: string[] } | undefined {
  for (const [tag, name, accounts, args] of SVM[program] ?? []) {
    let at = tag.length / 2;
    if (data.subarray(0, at).toString("hex") !== tag) continue;
    const shown = args
      .split(" ")
      .filter(Boolean)
      .map((arg) => {
        const [label, size] = arg.split(":");
        const bytes = Buffer.from(data.subarray(at, (at += Number(size))));
        return `${label}: ${BigInt(`0x${bytes.reverse().toString("hex") || "0"}`)}`;
      });
    if (at === data.length)
      return {
        call: `${name}(${shown.join(", ")})`,
        roles: accounts.split(" "),
      };
  }
  return undefined;
}
