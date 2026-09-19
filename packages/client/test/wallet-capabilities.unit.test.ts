import { describe, expect, it, vi } from "vitest";

import { walletCapabilities } from "../src";

const signal = new AbortController().signal;

describe("walletCapabilities", () => {
  it("executes a complete EVM Action through the active wallet", async () => {
    const switchChain = vi.fn().mockResolvedValue(undefined);
    const sendCalls = vi.fn().mockResolvedValue({
      hashes: ["0xfirst", "0xsecond"],
    });
    const capability = walletCapabilities({
      evm: {
        address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        chainId: 10,
        switchChain,
        sendCalls,
      },
    }).execute_evm;

    await expect(
      capability!(
        {
          type: "execute_evm",
          transactions: [
            {
              chain_id: 1,
              from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              data: "0x01",
              value: "1",
              label: "First",
              kind: "call",
            },
            {
              chain_id: 1,
              from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              to: "0xcccccccccccccccccccccccccccccccccccccccc",
              data: "0x02",
              label: "Second",
              kind: "call",
            },
          ],
        },
        signal,
      ),
    ).resolves.toEqual({
      status: "submitted",
      legs: [
        { id: "leg_1", status: "submitted", transactionId: "0xfirst" },
        { id: "leg_2", status: "submitted", transactionId: "0xsecond" },
      ],
    });
    expect(switchChain).toHaveBeenCalledWith(1);
    expect(sendCalls).toHaveBeenCalledWith({
      chainId: 1,
      calls: [
        {
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          data: "0x01",
          value: "1",
        },
        {
          to: "0xcccccccccccccccccccccccccccccccccccccccc",
          data: "0x02",
          value: undefined,
        },
      ],
    });
  });

  it("executes complete SVM transactions without consulting runtime state", async () => {
    const switchCluster = vi.fn().mockResolvedValue(undefined);
    const signAndSendTransaction = vi
      .fn()
      .mockResolvedValue({
        signature: "svm-signature",
        signedTransaction: "signed",
      });
    const capability = walletCapabilities({
      svm: {
        address: "payer",
        cluster: "devnet",
        switchCluster,
        signAndSendTransaction,
      },
    }).execute_svm;

    await expect(
      capability!(
        {
          type: "execute_svm",
          transactions: [
            {
              payer: "payer",
              cluster: "mainnet-beta",
              version: "legacy",
              instructions: [],
              unsigned_transaction_base64: "unsigned",
              description: "Transfer",
              kind: "transfer",
            },
          ],
        },
        signal,
      ),
    ).resolves.toEqual({
      status: "submitted",
      legs: [
        {
          id: "leg_1",
          status: "submitted",
          transactionId: "svm-signature",
          signedTransactionBase64: "signed",
        },
      ],
    });
    expect(switchCluster).toHaveBeenCalledWith("mainnet-beta");
    expect(signAndSendTransaction).toHaveBeenCalledWith({
      transactionBase64: "unsigned",
      cluster: "mainnet-beta",
    });
  });

  it("returns an SVM signature for an operation and signed bytes otherwise", async () => {
    const signTransaction = vi.fn().mockResolvedValue({
      signature: "payer-signature",
      signedTransaction: "signed-transaction",
    });
    const capability = walletCapabilities({
      svm: { address: "payer", cluster: "devnet", signTransaction },
    }).sign;
    const request = {
      type: "sign" as const,
      requestId: "request-1",
      chainFamily: "svm" as const,
      executionKind: "transaction",
      signer: "payer",
      cluster: "devnet",
      description: "Sign transaction",
      payloads: [
        { kind: "svm_transaction" as const, transaction_base64: "unsigned" },
      ],
    };

    await expect(
      capability!({ ...request, operationId: "operation-1" }, signal),
    ).resolves.toEqual({
      status: "signed",
      outputs: [{ id: "payload_1", signature: "payer-signature" }],
    });
    await expect(capability!(request, signal)).resolves.toEqual({
      status: "signed",
      outputs: [
        {
          id: "payload_1",
          signedTransactionBase64: "signed-transaction",
        },
      ],
    });
  });
});
