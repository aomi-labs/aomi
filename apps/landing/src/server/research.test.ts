// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { readResearchPost } from "./research";
describe("bundled research articles", () => {
  it("reads real markdown independently of the request working directory", async () => {
    const cwd = vi
      .spyOn(process, "cwd")
      .mockImplementation(() => "/not-a-checkout");
    try {
      const post = await readResearchPost("auth-across-two-worlds");
      expect(post?.title).toContain("One User, Many Wallets");
      expect(post?.body).toContain("wallet");
      expect(post?.body.length).toBeGreaterThan(1000);
    } finally {
      cwd.mockRestore();
    }
  });
  it("rejects missing and traversal slugs without filesystem access", async () => {
    expect(await readResearchPost("missing")).toBeNull();
    expect(await readResearchPost("../../package.json")).toBeNull();
  });
});
