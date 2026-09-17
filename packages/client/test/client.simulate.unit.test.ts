import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AomiClient } from "../src/client";
import { SimulationApiError } from "../src/simulation";

describe("AomiClient.simulateBatch", () => {
  const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retains typed partial evidence in a failed request", async () => {
    const detail = {
      code: "incomplete",
      message: "Simulation interrupted",
      partial: { contexts: [], steps: [] },
      interrupted_step: 2,
    };
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: detail }),
    } as Response);
    const client = new AomiClient({ baseUrl: "http://127.0.0.1:8080" });
    const error = await client
      .simulateBatch("session-1", [
        { to: "0x1111111111111111111111111111111111111111", chain_id: 5042002 },
      ])
      .catch((error) => error);
    expect(error).toBeInstanceOf(SimulationApiError);
    expect(error.detail).toEqual(detail);
    expect(error.status).toBe(503);
  });

  it("includes chain_id per transaction and falls back to options.chainId", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          contexts: [],
          steps: [],
        },
        fee: null,
      }),
    } as Response);

    const client = new AomiClient({ baseUrl: "http://127.0.0.1:8080" });
    await client.simulateBatch(
      "session-1",
      [
        {
          to: "0x1111111111111111111111111111111111111111",
          value: "1",
          chain_id: 10,
        },
        {
          to: "0x2222222222222222222222222222222222222222",
          value: "2",
        },
      ],
      { chainId: 1 },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as {
      transactions: Array<{ to: string; chain_id?: number }>;
      chain_id?: number;
    };

    expect(body.chain_id).toBe(1);
    expect(body.transactions[0]).toMatchObject({
      to: "0x1111111111111111111111111111111111111111",
      chain_id: 10,
    });
    expect(body.transactions[1]).toMatchObject({
      to: "0x2222222222222222222222222222222222222222",
      chain_id: 1,
    });
  });
});
