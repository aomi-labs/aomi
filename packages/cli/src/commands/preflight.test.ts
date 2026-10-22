// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
  getChainId: vi.fn(),
  readContract: vi.fn(),
  getBalance: vi.fn(),
  estimateGas: vi.fn(),
  getGasPrice: vi.fn(),
}));
vi.mock("viem", async (original) => ({
  ...(await original<typeof import("viem")>()),
  createPublicClient: () => client,
}));
import { Erc20Transfer } from "./preflight";

const WALLET = {
  address: "0x1111111111111111111111111111111111111111",
  chainId: 1,
  token: "0x3333333333333333333333333333333333333333",
  decimals: 6,
  rpcUrl: "https://user:secret@rpc.example",
};
const RECIPIENT = "0x2222222222222222222222222222222222222222";
const ETH = BigInt("1000000000000000000");

function chain({
  chainId = 1,
  decimals = 6,
  balance = BigInt(2_000_000_000),
  native = ETH,
} = {}) {
  client.getChainId.mockResolvedValue(chainId);
  client.readContract.mockImplementation(async ({ functionName }) =>
    functionName === "decimals" ? decimals : balance,
  );
  client.getBalance.mockResolvedValue(native);
  client.estimateGas.mockResolvedValue(BigInt(50_000));
  client.getGasPrice.mockResolvedValue(BigInt(20_000_000_000));
}

beforeEach(() => vi.resetAllMocks());

it("reports a wallet that covers the transfer and its gas", async () => {
  chain();
  const [report] = await new Erc20Transfer("1500", RECIPIENT, [
    WALLET,
  ]).funding();
  expect(report).toMatchObject({
    state: "funded",
    balance: "2000",
    nativeBalance: ETH.toString(),
    gasBudget: (BigInt(50_000) * BigInt(20_000_000_000) * BigInt(2)).toString(),
  });
  expect(client.estimateGas).toHaveBeenCalledWith(
    expect.objectContaining({ account: WALLET.address, to: WALLET.token }),
  );
});

it("separates a token shortfall from a gas shortfall", async () => {
  chain({ balance: BigInt(1_000) });
  const transfer = new Erc20Transfer("1500", RECIPIENT, [WALLET]);
  expect((await transfer.funding())[0]).toMatchObject({
    state: "insufficient_token",
    balance: "0.001",
    gasBudget: null,
  });
  expect(client.estimateGas).not.toHaveBeenCalled();

  chain({ native: BigInt(0) });
  expect((await transfer.funding())[0]?.state).toBe("insufficient_gas");
});

it("marks a wrong-chain or wrong-decimals RPC unavailable without leaking the URL", async () => {
  chain({ chainId: 8453 });
  const transfer = new Erc20Transfer("1500", RECIPIENT, [WALLET]);
  const [mismatch] = await transfer.funding();
  expect(mismatch).toMatchObject({ state: "unavailable", balance: null });
  expect(mismatch?.reason).toContain("chain 8453");
  expect(JSON.stringify(mismatch)).not.toContain("secret");

  chain({ decimals: 18 });
  expect((await transfer.funding())[0]?.reason).toContain("18 decimals");
});

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "aomi-preflight-"));
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

it("reads the intent file and rejects incomplete or non-decimal input", () => {
  const file = join(directory, "intent.json");
  writeFileSync(
    file,
    JSON.stringify({ amount: "1500", recipient: RECIPIENT, wallets: [WALLET] }),
  );
  expect(Erc20Transfer.fromFile(file).wallets).toHaveLength(1);
  writeFileSync(file, JSON.stringify({ amount: "1500", recipient: RECIPIENT }));
  expect(() => Erc20Transfer.fromFile(file)).toThrow("at least one");
  expect(() => new Erc20Transfer("1e3", RECIPIENT, [WALLET])).toThrow(
    "decimal",
  );
});
