// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./og-image";

afterEach(() => vi.unstubAllGlobals());

describe("Landing OpenGraph image", () => {
  it("renders the existing image dimensions without network or self-fetch", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("OpenGraph rendering must use bundled assets");
    });
    vi.stubGlobal("fetch", fetcher);
    const response = await GET(new Request("https://offline.invalid/api/og"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    const image = await response.arrayBuffer();
    expect(Array.from(new Uint8Array(image, 0, 8))).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]);
    const header = new DataView(image);
    expect(header.getUint32(16)).toBe(1200);
    expect(header.getUint32(20)).toBe(630);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
