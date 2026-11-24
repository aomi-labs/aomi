/**
 * One policy on chain: prepare, check what the backend asks, have the owner's
 * wallet do it, confirm. The same for every provider and every surface.
 */
import { decodeFunctionData, parseAbi } from "viem";
import { AomiApiError } from "../api-error";
import {
  normalizeSolanaCluster,
  type SvmCluster,
  type WalletEip712Payload,
} from "../wallet-utils";
import type {
  AccountPolicyTransport,
  AomiPolicyAction,
  AomiPolicyEnforcement,
  AomiPolicyTypedData,
  AomiWalletPolicies,
} from "./policy";

/** EIP-712 data as a wallet signs it: declared integers are bigints. */
export type AomiSignableTypedData = NonNullable<
  WalletEip712Payload["typed_data"]
>;

/**
 * The owner's wallet, as a surface connects it. A method left out is a step
 * this wallet cannot take.
 */
export type AomiPolicySigner = {
  /** The connected EVM account; a transaction is only sent from the owner's. */
  evmAddress?: string;
  /** Sign EIP-712 data as `signer` on `chainId`; answers the 0x signature. */
  signTypedData?: (request: {
    typedData: AomiSignableTypedData;
    signer: string;
    chainId: number;
    description: string;
  }) => Promise<string>;
  /** Send from the connected account on `chainId` and wait for the receipt. */
  sendEvmTransaction?: (transaction: {
    chainId: number;
    to: string;
    data: string;
    value: string;
  }) => Promise<void>;
  /** Sign and send an unsigned base64 transaction; answers its signature. */
  sendSolanaTransaction?: (transaction: {
    unsignedBase64: string;
    cluster: SvmCluster;
    description: string;
  }) => Promise<string>;
};

/**
 * The backend note that marks a signed revocation waiting to be sent. It
 * names the step for an entry without `next` and picks the row's label; the
 * wallet's action always comes from `prepare`.
 */
const SEND_NOTE_PREFIX = "Your revocation is signed. Send it";

export const sendsRevocation = (
  entry: Pick<AomiPolicyEnforcement, "ready" | "note">,
) => entry.ready && Boolean(entry.note?.startsWith(SEND_NOTE_PREFIX));

/** One provider's step for one rule on one network. */
export const enforcementKey = (
  entry: Pick<AomiPolicyEnforcement, "provider" | "network" | "rule">,
) => `${entry.provider}:${entry.network}:${entry.rule}`;

// Delegation Framework v1.3.0, the same addresses on every chain
// (`delegation.rs`, checked on Base and Ethereum mainnet).
export const DELEGATION_MANAGER = "0xdb9b1e94b5b69df7e401ddbede43491141047db3";
/** MetaMask's factory, and its `deploy(bytes,bytes32)`: how a vault is created. */
const SIMPLE_FACTORY = "0x69aa2f9fe1572f1b640e1bbc512f5c3a734fc77c";
const FACTORY = parseAbi([
  "function deploy(bytes _bytecode, bytes32 _salt) returns (address)",
]);

/** A well-formed factory `deploy` whose bytecode, not its salt, names `owner`. */
function deploysVaultOf(data: string, owner: string): boolean {
  try {
    const { functionName, args } = decodeFunctionData({
      abi: FACTORY,
      data: data as `0x${string}`,
    });
    return (
      functionName === "deploy" &&
      args[0].toLowerCase().includes(owner.toLowerCase().slice(2))
    );
  } catch {
    return false;
  }
}

// The wallet and the backend read the chain through different nodes, so a
// confirm can come before the backend's node shows the transaction.
async function settled<T>(confirm: () => Promise<T>, delayMs: number) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await confirm();
    } catch (cause) {
      if (
        attempt >= 5 ||
        !(cause instanceof AomiApiError) ||
        cause.code !== "chain_not_settled"
      )
        throw cause;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

const INTEGER_TYPE = /^u?int\d*$/;
const DECIMAL = /^-?\d+$/;
const HEX_NUMBER = /^0x[0-9a-f]+$/i;

const unreadable = (path: string) =>
  new Error(`The data to sign has a number this wallet can't read (${path}).`);

/** An integer field as a bigint: never a number past 2^53, which JSON rounded. */
function integer(value: unknown, path: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value))
    return BigInt(value);
  if (
    typeof value === "string" &&
    (DECIMAL.test(value) || HEX_NUMBER.test(value))
  )
    return BigInt(value);
  throw unreadable(path);
}

/** `value` of EIP-712 `type`: integers as bigint, structs and arrays walked. */
function typedValue(
  type: string,
  value: unknown,
  types: AomiPolicyTypedData["types"],
  path: string,
): unknown {
  if (type.endsWith("]")) {
    if (!Array.isArray(value)) throw unreadable(path);
    const item = type.slice(0, type.lastIndexOf("["));
    return value.map((entry, index) =>
      typedValue(item, entry, types, `${path}[${index}]`),
    );
  }
  if (INTEGER_TYPE.test(type)) return integer(value, path);
  const fields = types[type];
  if (!fields) return value;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw unreadable(path);
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    fields.map((field) => [
      field.name,
      typedValue(
        field.type,
        record[field.name],
        types,
        `${path}.${field.name}`,
      ),
    ]),
  );
}

/**
 * The backend's typed data as the wallet signs it: declared integers become
 * bigints (they arrive as strings past 2^53). Refuses JSON-rounded numbers
 * and a domain for another chain than `chainId`.
 */
export function signableTypedData(data: AomiPolicyTypedData, chainId: number) {
  if (!data.types[data.primaryType])
    throw new Error("The data to sign names a type it does not define.");
  const domain = { ...data.domain };
  if (domain.chainId !== undefined) {
    if (integer(domain.chainId, "domain.chainId") !== BigInt(chainId))
      throw new Error(
        "The data to sign is for another chain than this policy's.",
      );
    domain.chainId = chainId;
  }
  return {
    domain,
    types: data.types,
    primaryType: data.primaryType,
    message: typedValue(
      data.primaryType,
      data.message,
      data.types,
      "message",
    ) as Record<string, unknown>,
  } as AomiSignableTypedData;
}

const PLAIN_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

async function act(
  signer: AomiPolicySigner,
  entry: AomiPolicyEnforcement,
  action: AomiPolicyAction,
  description: string,
  owner: string,
): Promise<{ signature?: string }> {
  if (action.network !== entry.network)
    throw new Error(
      "Aomi asked for a signature on another network than this policy's. Nothing was signed.",
    );
  if (action.kind === "typed_data") {
    const chainId = /^eip155:(\d+)$/.exec(action.network)?.[1];
    if (entry.signer.family !== "evm" || !chainId || !signer.signTypedData)
      throw new Error("This wallet can't sign that.");
    const signature = await signer.signTypedData({
      typedData: signableTypedData(action.typed_data, Number(chainId)),
      signer: owner,
      chainId: Number(chainId),
      description,
    });
    if (!/^0x[0-9a-f]+$/i.test(signature))
      throw new Error("Your wallet returned no signature.");
    return { signature };
  }
  if (action.kind === "evm_transaction") {
    const chainId = /^eip155:(\d+)$/.exec(action.network)?.[1];
    if (entry.signer.family !== "evm" || !chainId || !signer.sendEvmTransaction)
      throw new Error("This wallet can't send that.");
    if (!PLAIN_ADDRESS.test(action.to))
      throw new Error(
        "Aomi asked to send to something that is not an address. Nothing was sent.",
      );
    // A MetaMask revocation goes to the manager. An undeployed vault is first
    // created by the factory, and only as this owner's vault.
    const to = action.to.toLowerCase();
    const deploysOwnVault =
      to === SIMPLE_FACTORY && deploysVaultOf(action.data, owner);
    if (
      entry.provider === "metamask" &&
      to !== DELEGATION_MANAGER &&
      !deploysOwnVault
    )
      throw new Error("The revocation targets a different delegation manager.");
    if (BigInt(action.value) !== BigInt(0))
      throw new Error(
        "Aomi asked to send funds with the revocation. Nothing was sent.",
      );
    if (owner.toLowerCase() !== signer.evmAddress?.toLowerCase())
      throw new Error(
        "Send this from the wallet that owns the policy. Nothing was sent.",
      );
    await signer.sendEvmTransaction({
      chainId: Number(chainId),
      to: action.to,
      data: action.data,
      value: action.value,
    });
    return {};
  }
  const cluster = normalizeSolanaCluster(action.network);
  if (
    entry.signer.family !== "svm" ||
    !cluster ||
    !signer.sendSolanaTransaction
  )
    throw new Error("This wallet can't sign that transaction.");
  await signer.sendSolanaTransaction({
    unsignedBase64: action.unsigned_base64,
    cluster,
    description,
  });
  return {};
}

/** A replacement can keep the same rule key after the old grant is disabled. */
const stillHeld = (policies: AomiWalletPolicies, key: string) =>
  policies.enforcement.some(
    (entry) => enforcementKey(entry) === key && sendsRevocation(entry),
  );

export type AomiPolicyEnforceOptions = {
  /** The policies' revision as the owner saw them. */
  revision: number;
  /** The owner's wallet that signs. */
  owner: string;
  /** Take the policy off the chain. */
  remove?: boolean;
  /** What the wallet is about to be asked, before it is. */
  onAction?: (action: AomiPolicyAction) => void;
  retryDelayMs?: number;
};

/**
 * Deploy, replace or `remove` the entry's policy with the owner's wallet.
 * `settled` is false when a sent transaction is not on the backend's node
 * yet: read again before sending anything more.
 */
export async function enforcePolicy(
  transport: Pick<
    AccountPolicyTransport,
    "prepareEnforcement" | "confirmEnforcement"
  >,
  agentWalletId: string,
  entry: AomiPolicyEnforcement,
  signer: AomiPolicySigner,
  {
    revision,
    owner,
    remove = false,
    onAction,
    retryDelayMs = 2_000,
  }: AomiPolicyEnforceOptions,
): Promise<{ policies: AomiWalletPolicies; settled: boolean }> {
  const key = enforcementKey(entry);
  const request = {
    network: entry.network,
    rule: entry.rule,
    revision,
    owner,
    ...(remove ? { remove } : {}),
  };
  const action = await transport.prepareEnforcement(
    agentWalletId,
    entry.provider,
    request,
  );
  let signature: string | undefined;
  if (action) {
    onAction?.(action);
    signature = (
      await act(
        signer,
        entry,
        action,
        remove ? "Remove policy from chain" : "Enforce policy on chain",
        owner,
      )
    ).signature;
  }
  const confirm = () =>
    settled(
      () =>
        transport.confirmEnforcement(agentWalletId, entry.provider, {
          ...request,
          ...(signature ? { signature } : {}),
        }),
      retryDelayMs,
    );
  let policies = await confirm();
  // No signature proves a sent tx: policies come back unchanged until the
  // backend's node shows it.
  const sent = action?.kind === "evm_transaction";
  for (
    let attempt = 0;
    sent && attempt < 5 && stillHeld(policies, key);
    attempt += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    policies = await confirm();
  }
  return { policies, settled: !(sent && stillHeld(policies, key)) };
}
