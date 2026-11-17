import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { operateAgentDetailFetch, operateFetch } from "./client";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("operate client Project identity", () => {
  it("addresses usage by Project without a platform override", async () => {
    await operateFetch("usage", { projectId: 1620 });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/build/operate/usage?projectId=1620",
      { signal: expect.any(AbortSignal) },
    );
  });

  it("addresses agent detail by its canonical agent id", async () => {
    await operateAgentDetailFetch(2938032, "7d");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/build/operate/observability/detail?agentId=2938032&window=7d",
      { signal: expect.any(AbortSignal) },
    );
  });
});

describe("operate client deadline", () => {
  it("passes an abort signal so a stalled read cannot hang the view", async () => {
    await operateFetch("transactions");

    const [, init] = fetchMock.mock.calls[0] as [
      string,
      { signal: AbortSignal },
    ];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("turns the abort into an actionable error", async () => {
    fetchMock.mockRejectedValue(
      new DOMException("The operation timed out.", "TimeoutError"),
    );

    await expect(operateFetch("transactions")).rejects.toThrow(
      /transactions timed out after \d+s/,
    );
  });
});
