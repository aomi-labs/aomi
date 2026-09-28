import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OnchainLink, recognizeOnchainLink } from "./onchain-link";

const HASH = `0x${"a".repeat(64)}`;
const ADDRESS = `0x${"b".repeat(40)}`;

describe("on-chain explorer links", () => {
  it("accepts configured HTTPS explorers with valid path and identifier types", () => {
    expect(
      recognizeOnchainLink(`https://basescan.org/tx/${HASH}`),
    ).toMatchObject({
      chainId: 8453,
      kind: "tx",
    });
    expect(
      recognizeOnchainLink(`https://arbiscan.io/address/${ADDRESS}`)?.kind,
    ).toBe("address");
    expect(
      recognizeOnchainLink(`https://basescan.org/token/${ADDRESS}`)?.kind,
    ).toBe("token");
    expect(recognizeOnchainLink("https://basescan.org/block/123")?.kind).toBe(
      "block",
    );
    expect(
      recognizeOnchainLink(`https://basescan.org/block/${HASH}`)?.kind,
    ).toBe("block");
  });

  it("rejects spoof origins, unexpected paths, query redirects, and wrong identifiers", () => {
    for (const url of [
      `http://basescan.org/tx/${HASH}`,
      `https://basescan.org.evil.test/tx/${HASH}`,
      `https://basescan.org@evil.test/tx/${HASH}`,
      `https://user@basescan.org/tx/${HASH}`,
      `https://basescan.org/tx/${HASH}?next=https://evil.test`,
      `https://basescan.org/tx/${HASH}#details`,
      `https://basescan.org/tx/${ADDRESS}`,
      `https://basescan.org/address/${HASH}`,
      `https://basescan.org/tx/${HASH}/extra`,
      `https://basescan.org/tx%2f${HASH}`,
      `https://basescan.org/approve/${HASH}`,
    ]) {
      expect(recognizeOnchainLink(url), url).toBeNull();
    }
    expect(
      recognizeOnchainLink(`https://basescan.org/tx/${HASH}`, 42161),
    ).toBeNull();
  });

  it("does not treat a local chain as a configured public explorer", () => {
    expect(
      recognizeOnchainLink(`https://basescan.org/tx/${HASH}`, 31337),
    ).toBeNull();
  });

  it("renders an accessible highlighted link and ordinary fallback", () => {
    const { rerender } = render(
      <OnchainLink href={`https://basescan.org/tx/${HASH}`}>
        View transaction
      </OnchainLink>,
    );
    const link = screen.getByRole("link", {
      name: "View transaction on Base explorer",
    });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");

    rerender(
      <OnchainLink href="https://basescan.org.evil.test/tx/123">
        Help
      </OnchainLink>,
    );
    expect(screen.getByRole("link", { name: "Help" })).not.toHaveAttribute(
      "target",
    );
  });
});
