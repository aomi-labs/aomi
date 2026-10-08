// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  encodeFunctionData,
  erc20Abi,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  verifyMessage,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { CommitView } from "@aomi-labs/client";

const chainId = 5042002;
const recipient = "0x1111111111111111111111111111111111111111";
const usdc = "0x3600000000000000000000000000000000000000";

describe("Victor's fresh SIWE Arc Commit flow", () => {
  let stateDir: string;

  beforeEach(() => {
    vi.resetModules();
    stateDir = mkdtempSync(join(tmpdir(), "aomi-cli-arc-"));
    vi.stubEnv("AOMI_STATE_DIR", stateDir);
    vi.stubGlobal("location", undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    rmSync(stateDir, { recursive: true, force: true });
  });

  // Arc exposes native USDC at 18 decimals and its ERC-20 interface at 6.
  // The controlled upstream prepares both forms; no live funds or RPC are used.
  it.each(["native", "erc20"] as const)(
    "discovers, prompts, signs and reports a 0.1-USDC %s Commit without an Action or a mode change",
    async (kind) => {
      const privateKey = generatePrivateKey();
      const account = privateKeyToAccount(privateKey);
      const transaction = {
        to: kind === "native" ? recipient : usdc,
        value: kind === "native" ? "100000000000000000" : "0",
        data:
          kind === "native"
            ? ("0x" as Hex)
            : encodeFunctionData({
                abi: erc20Abi,
                functionName: "transfer",
                args: [recipient, 100000n],
              }),
        gas_limit: kind === "native" ? 21_000 : 65_000,
        max_fee_per_gas: "20000000000",
        max_priority_fee_per_gas: "0",
      };
      let view: CommitView | undefined;
      let signedBytes: Hex | undefined;
      let broadcastBytes: Hex | undefined;
      let manualReports = 0;
      const apiPaths: string[] = [];
      const config = {
        baseUrl: "https://portal.test",
        chain: chainId,
        chainRpcUrl: "https://arc-rpc.test",
        secrets: {},
      };
      const fetchMock = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(String(input));
          const body = init?.body ? JSON.parse(String(init.body)) : undefined;
          if (url.hostname === "arc-rpc.test") {
            if (body.method === "eth_getTransactionByHash") {
              expect(body.params).toEqual([keccak256(signedBytes!)]);
              return Response.json({
                jsonrpc: "2.0",
                id: body.id,
                result: null,
              });
            }
            if (body.method === "eth_sendRawTransaction") {
              broadcastBytes = body.params[0];
              expect(broadcastBytes).toBe(signedBytes);
              return Response.json({
                jsonrpc: "2.0",
                id: body.id,
                result: keccak256(broadcastBytes!),
              });
            }
            throw new Error(`Unexpected RPC method ${body.method}`);
          }
          apiPaths.push(url.pathname);
          if (url.pathname === "/api/auth/siwe/nonce") {
            return Response.json({
              nonce: "fresh-arc-nonce",
              domain: "portal.test",
            });
          }
          if (url.pathname === "/api/auth/siwe/verify") {
            expect(body.message).toContain(`Chain ID: ${chainId}`);
            expect(
              await verifyMessage({
                address: account.address,
                message: body.message,
                signature: body.signature,
              }),
            ).toBe(true);
            return Response.json(
              { user_id: "fresh-account" },
              { headers: { "set-auth-token": "fresh-siwe-session" } },
            );
          }
          if (url.pathname === "/v1/account/session/cli") {
            expect(new Headers(init?.headers).get("authorization")).toBe(
              "Bearer fresh-siwe-session",
            );
            return Response.json({
              sessionToken: "fresh-cli-session",
              expiresAt: "2099-01-01T00:00:00.000Z",
            });
          }
          // Agent, account and Commit requests must use the same verified CLI identity.
          expect(new Headers(init?.headers).get("authorization")).toBe(
            url.pathname === "/v1/account"
              ? "Bearer fresh-siwe-session"
              : "Bearer fresh-cli-session",
          );
          if (url.pathname === "/v1/account") {
            return Response.json({
              session: {
                betterAuthUserId: "fresh-account",
                expiresAt: "2099-01-01T00:00:00.000Z",
              },
            });
          }
          if (url.pathname === "/api/account") {
            return Response.json({
              signing_policies: [
                {
                  address: { chain: "evm", address: account.address },
                  mode: "manual",
                },
              ],
            });
          }
          if (url.pathname === "/v1/agent/chat") {
            expect(body.userState.evm).toMatchObject({
              address: account.address,
              chain_id: chainId,
            });
            view = {
              version: 1,
              commit_id: `arc-${kind}-commit`,
              thread_id: body.sessionId,
              stage_id: `evm:${chainId}`,
              chain_family: "evm",
              chain_ref: String(chainId),
              signer: account.address,
              broadcaster: "wallet",
              state: "needs_signature",
              transaction_id: null,
              failure_code: null,
              batch: null,
              wallet_attempt: null,
              review: {
                version: 1,
                revision: 1,
                digest: "arc-transfer-review",
                legs: [],
                request: {
                  type: "execute_evm",
                  transactions: [
                    {
                      chain_id: chainId,
                      from: account.address,
                      to: transaction.to,
                      value: transaction.value,
                      data: transaction.data,
                      label: "0.1 USDC transfer",
                      kind: "transaction",
                    },
                  ],
                  simulation: {
                    status: "passed",
                    balanceChanges: [],
                    approvals: [],
                    warnings: [],
                    fees: [],
                    guards: [],
                    gas: null,
                    logs: [],
                  },
                },
              },
              action: {
                kind: "sign",
                payload: {
                  kind: "evm_transaction",
                  chain_id: chainId,
                  signer: account.address,
                  nonce: 0,
                  transaction,
                },
              },
            };
            return eventPage();
          }
          if (url.pathname === `/v1/agent/chat/${view?.thread_id}`) {
            return eventPage();
          }
          if (url.pathname === `/api/commits/${view?.commit_id}`) {
            return Response.json(view);
          }
          if (url.pathname === `/api/commits/${view?.commit_id}/manual`) {
            manualReports += 1;
            if (body.kind === "signed") {
              expect(body.payloads).toHaveLength(1);
              signedBytes = body.payloads[0];
              view = {
                ...view!,
                version: 2,
                state: "awaiting_broadcast",
                action: {
                  kind: "broadcast",
                  signed_transaction: signedBytes!,
                  transaction_id: keccak256(signedBytes!),
                },
              };
            } else {
              expect(body).toEqual({
                kind: "broadcast",
                transaction_id: keccak256(broadcastBytes!),
              });
              view = {
                ...view!,
                version: 3,
                state: "submitted",
                action: null,
                transaction_id: body.transaction_id,
              };
            }
            return Response.json(view);
          }
          throw new Error(`Unexpected API path ${url.pathname}`);
        },
      );
      function eventPage() {
        return Response.json({
          session_id: view!.thread_id,
          cursor: "cursor-1",
          has_more: false,
          commits: [view],
          events: [
            {
              type: "turn_state_changed",
              event_id: "awaiting-commit",
              sequence: 1,
              turn_id: "transfer-turn",
              occurred_at: Date.now(),
              state: "awaiting_action",
            },
          ],
        });
      }
      vi.stubGlobal("fetch", fetchMock);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const { accountLoginCommand } = await import("./account");
      const { chatCommand } = await import("./chat");
      const { txCommand, signCommand } = await import("./wallet");
      const { CliSession } = await import("../cli-session");

      await accountLoginCommand({ ...config, privateKey }, { wallet: true });
      await chatCommand(
        config,
        "Prepare a 0.1 USDC transfer on Arc Testnet",
        false,
      );
      expect(log.mock.calls.flat().join("\n")).toContain(
        `Commit awaiting sign: arc-${kind}-commit`,
      );
      log.mockClear();
      await txCommand({ ...config, json: true });
      const listed = JSON.parse(String(log.mock.calls[0]![0]));
      expect(listed.actions).toEqual([]);
      expect(listed.commits).toHaveLength(1);
      expect(listed.commits[0].commit_id).toBe(view!.commit_id);
      // Reloaded command uses the saved SIWE identity and local signer, with
      // neither a legacy Action nor a signing-policy mutation involved.
      await signCommand(config, [view!.commit_id]);
      const parsed = parseTransaction(signedBytes!);
      expect(parsed).toMatchObject({
        type: "eip1559",
        chainId,
        nonce: 0,
        to: transaction.to,
        gas: BigInt(transaction.gas_limit),
        maxFeePerGas: 20_000_000_000n,
      });
      // RLP zero quantities and empty calldata may be omitted by the parser.
      expect(parsed.value ?? 0n).toBe(BigInt(transaction.value));
      expect(parsed.data ?? "0x").toBe(transaction.data);
      expect(parsed.maxPriorityFeePerGas ?? 0n).toBe(0n);
      expect(
        await recoverTransactionAddress({
          serializedTransaction: signedBytes!,
        }),
      ).toBe(account.address);
      expect(manualReports).toBe(2);
      expect(view!.state).toBe("submitted");
      expect(broadcastBytes).toBe(signedBytes);
      expect(CliSession.load()!.toState().auth?.betterAuthUserId).toBe(
        "fresh-account",
      );
      expect(apiPaths).not.toContain("/api/auth/sign-in/anonymous");
    },
  );
});
