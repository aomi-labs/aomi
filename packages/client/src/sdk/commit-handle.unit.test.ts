import { afterEach, describe, expect, it, vi } from "vitest";
import { Aomi } from "./aomi";
import { AomiClient } from "../client";
import { AomiCommits } from "./commits";
import {
  CommitNotFoundError,
  CommitStaleError,
  type CommitRefView,
} from "../commit-ref";
import type { Wallets } from "../wallet/types";

const signer = "0x1111111111111111111111111111111111111111";
const ref = "5f0c2a1e-8d4b-4c3a-9e7f-1b2c3d4e5f60";

const view = (overrides: Partial<CommitRefView> = {}): CommitRefView => ({
  version: 3,
  commit_id: ref,
  thread_id: "mcp-session-1",
  stage_id: "direct:a:0",
  chain_family: "evm",
  chain_ref: "1",
  signer,
  broadcaster: "wallet",
  state: "needs_signature",
  transaction_id: null,
  failure_code: null,
  batch: null,
  wallet_attempt: null,
  review: {
    version: 3,
    revision: 1,
    digest: "digest-3",
    request: {
      type: "execute_evm",
      transactions: [
        {
          chain_id: 1,
          from: signer,
          to: "0x2222222222222222222222222222222222222222",
          data: "0x",
          label: "Transfer",
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
    legs: [],
  },
  action: {
    kind: "sign",
    payload: {
      kind: "evm_transaction",
      chain_id: 1,
      signer,
      transaction: {
        to: "0x2222222222222222222222222222222222222222",
        data: "0x",
        value: "0",
        nonce: 0,
        gas: "21000",
        max_fee_per_gas: "1",
        max_priority_fee_per_gas: "1",
      },
    },
  } as CommitRefView["action"],
  origin: "mcp",
  origin_app: null,
  initiator: "mcp:client-1",
  notify: "mcp:client-1",
  sign_url: `https://portal.example/sign/${ref}`,
  created_at: 1_760_529_600,
  ...overrides,
});

type Route = (body: unknown) => Response;

function backend(routes: Record<string, Route | Route[]>) {
  const calls: {
    method: string;
    path: string;
    body: unknown;
    headers: Headers;
  }[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({
      method,
      path: url.pathname,
      body,
      headers: new Headers(init?.headers),
    });
    const route = routes[`${method} ${url.pathname}`];
    const handler = Array.isArray(route) ? route.shift() : route;
    if (!handler)
      return Response.json({ error: "unexpected" }, { status: 500 });
    return handler(body);
  });
  const aomi = new Aomi({
    baseUrl: "https://api.example",
    guest: false,
    fetch,
  });
  return { aomi, calls };
}

const handles: { close(): void }[] = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
});

describe("aomi.commits — thread-less commit refs", () => {
  it("opens a ref without a thread and refreshes it", async () => {
    const { aomi, calls } = backend({
      [`GET /v1/commits/${ref}`]: [
        () => Response.json(view()),
        () => Response.json(view({ version: 4, state: "expired" })),
      ],
    });
    const handle = await aomi.commits.get(ref);
    handles.push(handle);

    expect(handle.view).toMatchObject({
      commit_id: ref,
      origin: "mcp",
      sign_url: `https://portal.example/sign/${ref}`,
    });
    expect(handle.review?.type).toBe("execute_evm");
    expect(calls[0]?.headers.has("x-thread-id")).toBe(false);
    expect(calls[0]?.headers.has("x-session-id")).toBe(false);

    const refreshed = await handle.refresh();
    expect(refreshed).toMatchObject({ version: 4, state: "expired" });
    expect(handle.view.state).toBe("expired");
  });

  it("signs at the reviewed version and digest, then broadcasts bound to the new version", async () => {
    const broadcasting = view({
      version: 4,
      state: "awaiting_broadcast",
      action: {
        kind: "broadcast",
        signed_transaction: "0xsigned",
        transaction_id: "0xhash",
      },
    });
    const { aomi, calls } = backend({
      [`GET /v1/commits/${ref}`]: () => Response.json(view()),
      [`POST /v1/commits/${ref}/sign`]: () => Response.json(broadcasting),
      [`POST /v1/commits/${ref}/broadcast`]: () =>
        Response.json(
          view({
            version: 5,
            state: "submitted",
            action: null,
            transaction_id: "0xhash",
          }),
        ),
    });
    const signTransaction = vi.fn(async () => "0xsigned");
    const wallet: Wallets = {
      evm: {
        address: signer,
        chainId: () => 1,
        signTransaction,
        broadcastTransaction: vi.fn(async () => "0xhash"),
      },
    };
    const handle = await aomi.commits.get(ref);
    handles.push(handle);

    const result = await handle.sign(wallet);

    expect(signTransaction).toHaveBeenCalledOnce();
    expect(result.state).toBe("submitted");
    const writes = calls.filter((call) => call.method === "POST");
    expect(writes.map((call) => [call.path, call.body])).toEqual([
      [
        `/v1/commits/${ref}/sign`,
        { version: 3, review_digest: "digest-3", payloads: ["0xsigned"] },
      ],
      [
        `/v1/commits/${ref}/broadcast`,
        { version: 4, review_digest: "digest-3", transaction_id: "0xhash" },
      ],
    ]);
    expect(writes.every((call) => !call.headers.has("x-thread-id"))).toBe(true);
  });

  it("asks OAuth for agent:read to read and agent:write to write", async () => {
    const observed: [string, readonly string[]][] = [];
    const client = new AomiClient({
      baseUrl: "https://api.example",
      guest: false,
      fetch: vi.fn(async (_input, init) =>
        Response.json(
          init?.method === "POST"
            ? view({ version: 4, state: "rejected", action: null })
            : view(),
        ),
      ),
      oauth: async (request) => {
        observed.push([request.resource, request.scopes]);
        return {
          accessToken: "disposable-test-token",
          expiresAt: Date.now() + 60_000,
          resource: request.resource,
          scopes: request.scopes,
        };
      },
    });
    const handle = await new AomiCommits(client).get(ref);
    handles.push(handle);
    await handle.reject();
    expect(observed).toEqual([
      ["https://api.example/v1/agent", ["agent:read"]],
      ["https://api.example/v1/agent", ["agent:write"]],
    ]);
  });

  it("rejects at the current version", async () => {
    const { aomi, calls } = backend({
      [`GET /v1/commits/${ref}`]: () => Response.json(view()),
      [`POST /v1/commits/${ref}/reject`]: () =>
        Response.json(view({ version: 4, state: "rejected", action: null })),
    });
    const handle = await aomi.commits.get(ref);
    handles.push(handle);

    const result = await handle.reject();

    expect(result.state).toBe("rejected");
    expect(calls.at(-1)).toMatchObject({
      method: "POST",
      path: `/v1/commits/${ref}/reject`,
      body: { version: 3 },
    });
  });

  it.each([
    ["backend", { code: "commit_not_found", status: 404 }],
    [
      "api-server",
      {
        error: {
          code: "commit_not_found",
          message: "Commit not found",
          details: { code: "commit_not_found", status: 404 },
        },
      },
    ],
  ])(
    "raises CommitNotFoundError for a missing or foreign ref (%s body)",
    async (_, body) => {
      const { aomi } = backend({
        [`GET /v1/commits/${ref}`]: () => Response.json(body, { status: 404 }),
      });
      const error = await aomi.commits.get(ref).catch((caught) => caught);
      expect(error).toBeInstanceOf(CommitNotFoundError);
      expect(error).toMatchObject({ status: 404, code: "commit_not_found" });
    },
  );

  it("keeps a 404 without the commit code a plain API error", async () => {
    const { aomi } = backend({
      [`GET /v1/commits/${ref}`]: () =>
        Response.json({ error: "not_found" }, { status: 404 }),
    });
    const error = await aomi.commits.get(ref).catch((caught) => caught);
    expect(error).not.toBeInstanceOf(CommitNotFoundError);
    expect(error).toMatchObject({ status: 404, code: "not_found" });
  });

  it("surfaces a server version conflict as CommitStaleError", async () => {
    const { aomi } = backend({
      [`GET /v1/commits/${ref}`]: () => Response.json(view()),
      [`POST /v1/commits/${ref}/sign`]: () =>
        Response.json(
          { code: "commit_version_conflict", status: 409 },
          { status: 409 },
        ),
    });
    const handle = await aomi.commits.get(ref);
    handles.push(handle);

    const error = await handle
      .sign({
        evm: {
          address: signer,
          chainId: () => 1,
          signTransaction: async () => "0xsigned",
        },
      })
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(CommitStaleError);
    expect(error).toMatchObject({
      status: 409,
      code: "commit_version_conflict",
    });
  });

  it("reads an api-server wrapped digest mismatch as CommitStaleError", async () => {
    const { aomi } = backend({
      [`GET /v1/commits/${ref}`]: () => Response.json(view()),
      [`POST /v1/commits/${ref}/reject`]: () =>
        Response.json(
          {
            error: {
              code: "commit_review_digest_mismatch",
              message: "Review changed",
              details: { code: "commit_review_digest_mismatch", status: 409 },
            },
          },
          { status: 409 },
        ),
    });
    const handle = await aomi.commits.get(ref);
    handles.push(handle);
    const error = await handle.reject().catch((caught) => caught);
    expect(error).toBeInstanceOf(CommitStaleError);
    expect(error).toMatchObject({ code: "commit_review_digest_mismatch" });
  });

  it("refuses to prompt the wallet when the commit changed since review", async () => {
    const { aomi, calls } = backend({
      [`GET /v1/commits/${ref}`]: [
        () => Response.json(view()),
        () =>
          Response.json(
            view({
              version: 4,
              review: { ...view().review!, version: 4, digest: "digest-4" },
            }),
          ),
      ],
    });
    const signTransaction = vi.fn(async () => "0xsigned");
    const handle = await aomi.commits.get(ref);
    handles.push(handle);

    const error = await handle
      .sign({ evm: { address: signer, chainId: () => 1, signTransaction } })
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(CommitStaleError);
    expect(signTransaction).not.toHaveBeenCalled();
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });
});
