import { readFileSync } from "node:fs";
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  getAddress,
  http,
  parseUnits,
  type Address,
} from "viem";
import { fatal } from "../errors";
import { printJson } from "../output";

export type FundingWallet = {
  address: string;
  chainId: number;
  token: string;
  decimals: number;
  rpcUrl: string;
};
export type WalletFunding = {
  address: Address;
  chainId: number;
  token: Address;
  state: "funded" | "insufficient_token" | "insufficient_gas" | "unavailable";
  balance: string | null;
  nativeBalance: string | null;
  /** Estimated gas times twice the current gas price, in native base units. */
  gasBudget: string | null;
  reason?: string;
};

/** One exact ERC-20 transfer and the catalogued wallets that might fund it. Read-only; never signs. */
export class Erc20Transfer {
  readonly recipient: Address;

  constructor(
    readonly amount: string,
    recipient: string,
    readonly wallets: readonly FundingWallet[],
  ) {
    if (!/^\d+(?:\.\d+)?$/.test(amount))
      throw new Error("amount must be a positive decimal string");
    this.recipient = getAddress(recipient);
    if (!Array.isArray(wallets) || wallets.length === 0)
      throw new Error("wallets must list at least one catalogued wallet");
  }

  static fromFile(path: string): Erc20Transfer {
    const input = JSON.parse(readFileSync(path, "utf8")) as Partial<{
      amount: string;
      recipient: string;
      wallets: FundingWallet[];
    }>;
    if (typeof input.amount !== "string" || typeof input.recipient !== "string")
      throw new Error("intent file requires amount, recipient and wallets");
    return new Erc20Transfer(
      input.amount,
      input.recipient,
      input.wallets ?? [],
    );
  }

  /** Live token balance, native balance and gas budget for every wallet, each on its own RPC. */
  funding(): Promise<WalletFunding[]> {
    return Promise.all(
      this.wallets.map(async (wallet): Promise<WalletFunding> => {
        const address = getAddress(wallet.address);
        const token = getAddress(wallet.token);
        const report: WalletFunding = {
          address,
          chainId: wallet.chainId,
          token,
          state: "unavailable",
          balance: null,
          nativeBalance: null,
          gasBudget: null,
        };
        try {
          const client = createPublicClient({ transport: http(wallet.rpcUrl) });
          const erc20 = { address: token, abi: erc20Abi } as const;
          const [chainId, decimals, balance, nativeBalance] = await Promise.all(
            [
              client.getChainId(),
              client.readContract({ ...erc20, functionName: "decimals" }),
              client.readContract({
                ...erc20,
                functionName: "balanceOf",
                args: [address],
              }),
              client.getBalance({ address }),
            ],
          );
          if (chainId !== wallet.chainId)
            throw new Error(
              `RPC serves chain ${chainId}, not ${wallet.chainId}`,
            );
          if (decimals !== wallet.decimals)
            throw new Error(
              `token has ${decimals} decimals, not ${wallet.decimals}`,
            );
          const amount = parseUnits(this.amount, decimals);
          report.balance = formatUnits(balance, decimals);
          report.nativeBalance = nativeBalance.toString();
          if (balance < amount) {
            report.state = "insufficient_token";
            return report;
          }
          const [gas, gasPrice] = await Promise.all([
            client.estimateGas({
              account: address,
              to: token,
              data: encodeFunctionData({
                abi: erc20Abi,
                functionName: "transfer",
                args: [this.recipient, amount],
              }),
            }),
            client.getGasPrice(),
          ]);
          const budget = gas * gasPrice * BigInt(2);
          report.gasBudget = budget.toString();
          report.state =
            nativeBalance >= budget ? "funded" : "insufficient_gas";
        } catch (error) {
          // viem's full message echoes the request, including the RPC URL;
          // keep only the short reason so credentialed endpoints stay private.
          report.reason =
            (error as { shortMessage?: string }).shortMessage ??
            (error instanceof Error ? error.message.split("\n")[0] : "unknown");
        }
        return report;
      }),
    );
  }
}

export async function preflightCommand(path: string): Promise<void> {
  try {
    printJson(await Erc20Transfer.fromFile(path).funding());
  } catch (error) {
    fatal(
      `Preflight failed: ${error instanceof Error ? error.message : "invalid intent file"}`,
    );
  }
}
