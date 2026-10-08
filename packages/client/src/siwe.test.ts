import { describe, expect, it } from "vitest";
import { parseSiweMessage } from "viem/siwe";
import { buildSiweMessage, buildWalletLinkMessage } from "./siwe";

const proof = {
  address: "0x1111111111111111111111111111111111111111",
  chainId: 1,
  nonce: "abcdefgh12345678",
  domain: "localhost:3002",
  uri: "http://localhost:3002",
  issuedAt: new Date("2026-10-05T22:00:00Z"),
};
describe("account proof messages", () => {
  it("binds sign-in to the server challenge including its expiry", () => {
    const expirationTime = new Date("2026-10-05T22:05:00Z");
    const parsed = parseSiweMessage(buildSiweMessage({ ...proof, expirationTime }));
    expect(parsed).toMatchObject({
      address: proof.address,
      domain: proof.domain,
      uri: proof.uri,
      nonce: proof.nonce,
      chainId: proof.chainId,
      issuedAt: proof.issuedAt,
      expirationTime,
      statement: "Sign in to Aomi.",
    });
  });
  it("distinguishes linking a wallet from signing in", () => {
    const link = buildWalletLinkMessage(proof);
    expect(link).toContain("wants to link this wallet to your Aomi account:");
    expect(link).toContain("Only sign this message if you want this wallet attached");
    expect(link).toContain(`Nonce: ${proof.nonce}`);
    expect(link).not.toEqual(buildSiweMessage(proof));
  });
});
