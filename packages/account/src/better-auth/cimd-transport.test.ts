// @vitest-environment node
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { lookup, request } = vi.hoisted(() => ({
  lookup: vi.fn(),
  request: vi.fn(),
}));
vi.mock("node:dns/promises", () => ({ lookup }));
vi.mock("node:https", () => ({ request }));
import { fetchClientMetadataResource } from "@better-auth/cimd/node";

const address = { address: "104.18.32.7", family: 4 };
beforeEach(() => {
  vi.clearAllMocks();
  lookup.mockResolvedValue([address, { address: "104.18.33.7", family: 4 }]);
});

describe("CIMD pinned Node transport", () => {
  it.each([true, false])(
    "honors lookup all=%s while returning only the validated pinned address",
    async (all) => {
      request.mockImplementation((url, options, receive) => {
        expect(url.hostname).toBe("client.example");
        expect(options.servername).toBe("client.example");
        expect(options.headers.host).toBe("client.example");
        expect(options.agent).toBe(false);
        const callback = vi.fn();
        options.lookup(url.hostname, { all }, callback);
        if (all) expect(callback).toHaveBeenCalledWith(null, [address]);
        else
          expect(callback).toHaveBeenCalledWith(
            null,
            address.address,
            address.family,
          );
        const response = Object.assign(Readable.from([Buffer.from("{}")]), {
          headers: { "content-type": "application/json" },
          statusCode: 200,
          statusMessage: "OK",
        });
        const req = new EventEmitter();
        Object.assign(req, { end: () => receive(response) });
        return req;
      });
      const response = await fetchClientMetadataResource(
        "https://client.example/client.json",
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({});
      expect(lookup).toHaveBeenCalledWith("client.example", {
        all: true,
        verbatim: true,
      });
    },
  );

  it.each(["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1"])(
    "rejects a mixed DNS answer containing %s before connecting",
    async (privateAddress) => {
      lookup.mockResolvedValue([
        address,
        {
          address: privateAddress,
          family: privateAddress.includes(":") ? 6 : 4,
        },
      ]);
      await expect(
        fetchClientMetadataResource("https://client.example/client.json"),
      ).rejects.toThrow("public-routable");
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("rejects non-HTTPS metadata", async () => {
    await expect(
      fetchClientMetadataResource("http://client.example/client.json"),
    ).rejects.toThrow("HTTPS");
    expect(lookup).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
});
