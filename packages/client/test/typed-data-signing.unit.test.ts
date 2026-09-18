import { describe, expect, it, vi } from "vitest";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { walletCapabilities, type ActionRequest } from "../src";

const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
const typedData = {
  domain: {
    name: "Exchange",
    version: "1",
    chainId: 1337,
    verifyingContract: "0x0000000000000000000000000000000000000000" as const,
  },
  types: {
    Agent: [
      { name: "source", type: "string" },
      { name: "connectionId", type: "bytes32" },
    ],
  },
  primaryType: "Agent",
  message: { source: "a", connectionId: `0x${"ab".repeat(32)}` },
};
const request: Extract<ActionRequest, { type: "sign" }> = {
  type: "sign",
  requestId: "sign-domain",
  chainFamily: "evm",
  executionKind: "message",
  signer: account.address,
  chainId: 1337,
  description: "Sign test domain",
  payloads: [{ kind: "evm_typed_data", typed_data: typedData }],
};
const signal = new AbortController().signal;

describe("typed-data signing domains", () => {
  it.each([true, false])(
    "signs unchanged domain on another network (switch available: %s)",
    async (canSwitch) => {
      const switchChain = vi.fn();
      const signTypedData = vi.fn(async () => account.signTypedData(typedData));
      const sign = walletCapabilities({
        evm: {
          address: account.address,
          chainId: 1,
          signTypedData,
          ...(canSwitch ? { switchChain } : {}),
        },
      }).sign!;
      const result = await sign(request, signal);
      expect(switchChain).not.toHaveBeenCalled();
      expect(signTypedData).toHaveBeenCalledWith({ typedData });
      expect(signTypedData.mock.calls[0]).toEqual([{ typedData }]);
      expect(
        await recoverTypedDataAddress({
          ...typedData,
          signature: result.outputs[0].signature as `0x${string}`,
        }),
      ).toBe(account.address);
      expect(typedData.domain.chainId).toBe(1337);
    },
  );

  it("rejects the wrong signer before prompting and preserves provider rejection", async () => {
    const rejection = new Error("User rejected the request");
    const signTypedData = vi.fn().mockRejectedValue(rejection);
    const sign = walletCapabilities({
      evm: { address: account.address, signTypedData },
    }).sign!;
    await expect(
      sign({ ...request, signer: `0x${"22".repeat(20)}` }, signal),
    ).rejects.toThrow("not the requested signer");
    expect(signTypedData).not.toHaveBeenCalled();
    await expect(sign(request, signal)).rejects.toBe(rejection);
    expect(signTypedData).toHaveBeenCalledOnce();
  });

  it.each([true, false])(
    "still enforces chain 1337 for real transactions (switch available: %s)",
    async (canSwitch) => {
      const switchChain = vi.fn();
      const sendTransaction = vi.fn().mockResolvedValue("0xhash");
      const execute = walletCapabilities({
        evm: {
          address: account.address,
          chainId: 1,
          sendTransaction,
          ...(canSwitch ? { switchChain } : {}),
        },
      }).execute_evm!;
      const transaction: Extract<ActionRequest, { type: "execute_evm" }> = {
        type: "execute_evm",
        transactions: [
          {
            chain_id: 1337,
            from: account.address,
            to: account.address,
            data: "0x",
            label: "test",
            kind: "call",
          },
        ],
      };
      if (canSwitch) {
        await execute(transaction, signal);
        expect(switchChain).toHaveBeenCalledWith(1337);
        expect(sendTransaction).toHaveBeenCalledWith(
          expect.objectContaining({ chainId: 1337 }),
        );
      } else {
        await expect(execute(transaction, signal)).rejects.toThrow(
          "cannot switch to chain 1337",
        );
        expect(sendTransaction).not.toHaveBeenCalled();
      }
    },
  );
});
