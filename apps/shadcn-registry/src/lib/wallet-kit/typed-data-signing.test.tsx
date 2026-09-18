import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createConfig, injected } from "wagmi";
import { connect, signTypedData } from "wagmi/actions";
import { http, recoverTypedDataAddress, type TypedDataDefinition } from "viem";
import { mainnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { useActionCapabilities } from "./use-action-capabilities";
import { buildEvmExecutionRuntime } from "./execution/execution-runtime";
import type { EvmWalletRuntime } from "./runtime/evm/wallet-runtime";
import type { useAomiWalletKit } from "./context";

const state = vi.hoisted(() => ({
  wallet: null as unknown as ReturnType<typeof useAomiWalletKit>,
}));
vi.mock("./context", () => ({ useAomiWalletKit: () => state.wallet }));

// Exercises the actual Portal -> SDK -> runtime -> wagmi injected connector ->
// EIP-1193 path. The provider is a deterministic fixture, not a live wallet vendor.
describe("Portal typed-data adapter", () => {
  it.each([false, true])(
    "preserves Exchange domain through the connected adapter (provider refuses: %s)",
    async (refuses) => {
      const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
      const typedData = {
        domain: {
          name: "Exchange",
          version: "1",
          chainId: 1337,
          verifyingContract:
            "0x0000000000000000000000000000000000000000" as const,
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
      const request = vi.fn(
        async ({ method, params }: { method: string; params?: unknown[] }) => {
          if (method === "eth_chainId") return "0x1";
          if (method === "eth_accounts" || method === "eth_requestAccounts")
            return [account.address];
          if (method === "eth_signTypedData_v4") {
            expect(String(params?.[0]).toLowerCase()).toBe(
              account.address.toLowerCase(),
            );
            const payload = JSON.parse(params![1] as string);
            expect(payload.domain).toEqual(typedData.domain);
            expect(payload.message).toEqual(typedData.message);
            expect(payload.primaryType).toBe("Agent");
            expect(payload.types.Agent).toEqual(typedData.types.Agent);
            if (refuses)
              throw Object.assign(
                new Error("Provider does not support this signing domain"),
                { code: 4200 },
              );
            return account.signTypedData(payload as TypedDataDefinition);
          }
          throw new Error(`Unexpected RPC: ${method}`);
        },
      );
      const provider = { request, on: vi.fn(), removeListener: vi.fn() };
      const config = createConfig({
        chains: [mainnet],
        connectors: [
          injected({
            target: {
              id: "domain-fixture",
              name: "Domain fixture",
              provider: provider as never,
            },
          }),
        ],
        transports: { [mainnet.id]: http() },
        storage: null,
      });
      const connector = config.connectors[0];
      await connect(config, { connector });
      const switchChain = vi.fn();
      const runtime = buildEvmExecutionRuntime({
        activeConnector: connector,
        activeEvmConnection: { address: account.address, chainId: 1 },
        chainsById: { 1: mainnet },
        signTypedDataAsync: (args: unknown) =>
          signTypedData(config, args as never),
      } as unknown as EvmWalletRuntime);
      state.wallet = {
        identity: { address: account.address, chainId: 1 },
        supportedNetworks: { evm: [{ id: 1 }] },
        switchChain,
        signTypedData: runtime.signTypedData,
      } as unknown as ReturnType<typeof useAomiWalletKit>;
      const { result } = renderHook(() => useActionCapabilities());
      const signed = result.current.sign!(
        {
          type: "sign",
          requestId: "fixture",
          executionKind: "message",
          chainFamily: "evm",
          chainId: 1337,
          signer: account.address,
          description: "Signing domain fixture",
          payloads: [{ kind: "evm_typed_data", typed_data: typedData }],
        },
        new AbortController().signal,
      );
      if (refuses)
        await expect(signed).rejects.toThrow(
          "Provider does not support this signing domain",
        );
      else {
        const output = await signed;
        expect(
          await recoverTypedDataAddress({
            ...typedData,
            signature: output.outputs[0].signature as `0x${string}`,
          }),
        ).toBe(account.address);
      }
      expect(switchChain).not.toHaveBeenCalled();
      expect(
        request.mock.calls.filter(
          ([call]) => call.method === "eth_signTypedData_v4",
        ),
      ).toHaveLength(1);
      expect(
        request.mock.calls.some(
          ([call]) =>
            call.method === "wallet_switchEthereumChain" ||
            call.method === "personal_sign",
        ),
      ).toBe(false);
    },
  );
});
