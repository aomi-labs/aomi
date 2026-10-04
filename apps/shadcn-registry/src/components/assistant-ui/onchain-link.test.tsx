import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Give the local chain an explorer, so only the local-chain guard rejects it.
vi.mock("@aomi-labs/client", async (original) => {
  const client = await original<typeof import("@aomi-labs/client")>();
  return {
    ...client,
    CHAINS_BY_ID: {
      ...client.CHAINS_BY_ID,
      31337: {
        ...client.CHAINS_BY_ID[31337],
        blockExplorers: {
          default: { name: "Local", url: "https://local-explorer.test" },
        },
      },
    },
  };
});

import { OnchainLink, recognizeOnchainLink } from "./onchain-link";

const HASH = `0x${"a".repeat(64)}`;
const ADDRESS = `0x${"b".repeat(40)}`;
const SOLANA_ACCOUNT = "So11111111111111111111111111111111111111112";
// Solscan's own TX MAP documentation uses this transaction as its example.
const SOLANA_TX =
  "uzUc9i1WChEcyuQFT5v7Bn9s4WzGnbNqg8NPyDA8r7GRpmUsctac7hLvyvbiM1Cz3GC9KZZPvKD6RMAdoroX2Aj";

describe("on-chain explorer links", () => {
  it("renders unsafe schemes as copyable text", () => {
    const { rerender } = render(
      <OnchainLink href="javascript:alert(1)">Address</OnchainLink>,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Address")).toBeTruthy();
    rerender(<OnchainLink href="data:text/html,test">Address</OnchainLink>);
    expect(screen.queryByRole("link")).toBeNull();
  });
  it("recognizes exact Solscan account, token and transaction paths", () => {
    for (const href of [
      `https://solscan.io/account/${SOLANA_ACCOUNT}`,
      `https://solscan.io/token/${SOLANA_ACCOUNT}`,
      `https://solscan.io/tx/${SOLANA_TX}`,
      `https://solscan.io/account/${"1".repeat(32)}`,
      `https://solscan.io/tx/${"1".repeat(64)}`,
    ]) {
      expect(recognizeOnchainLink(href)).toEqual({
        chainId: null,
        chainName: "Solana",
        href,
      });
    }
  });

  it("rejects unsupported Solscan URLs and incorrectly sized base58 identifiers", () => {
    for (const href of [
      `http://solscan.io/account/${SOLANA_ACCOUNT}`,
      `https://solscan.io.evil.test/account/${SOLANA_ACCOUNT}`,
      `https://solscan.io@evil.test/account/${SOLANA_ACCOUNT}`,
      `https://user@solscan.io/account/${SOLANA_ACCOUNT}`,
      `https://solscan.io:444/account/${SOLANA_ACCOUNT}`,
      `https://solscan.io/account/${SOLANA_ACCOUNT}?cluster=devnet`,
      `https://solscan.io/account/${SOLANA_ACCOUNT}#transactions`,
      `https://solscan.io/address/${SOLANA_ACCOUNT}`,
      `https://solscan.io/block/${SOLANA_ACCOUNT}`,
      `https://solscan.io/account/${SOLANA_ACCOUNT}/extra`,
      `https://solscan.io/account%2f${SOLANA_ACCOUNT}`,
      `https://solscan.io/account/${ADDRESS}`,
      `https://solscan.io/account/${SOLANA_TX}`,
      `https://solscan.io/tx/${SOLANA_ACCOUNT}`,
      `https://solscan.io/account/${"z".repeat(44)}`,
      `https://solscan.io/tx/${"z".repeat(88)}`,
      `https://solscan.io/account/${"1".repeat(31)}`,
      `https://solscan.io/tx/${"1".repeat(63)}`,
      `https://solscan.io/account/${"0".repeat(32)}`,
      `https://solscan.io/tx/${"1".repeat(89)}`,
    ]) {
      expect(recognizeOnchainLink(href), href).toBeNull();
    }
  });

  it("preserves a supplied Solscan URL and already-linked code label", () => {
    const href = `https://SOLSCAN.io:443/account/${SOLANA_ACCOUNT}`;
    expect(recognizeOnchainLink(href)?.href).toBe(href);
    const { container, rerender } = render(
      <OnchainLink href={href}>
        <code>{SOLANA_ACCOUNT}</code>
      </OnchainLink>,
    );
    const link = screen.getByRole("link", {
      name: `${SOLANA_ACCOUNT} on Solana explorer`,
    });
    expect(link).toHaveAttribute("href", href);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(container.querySelectorAll("a")).toHaveLength(1);
    expect(link.querySelector("code")).toHaveTextContent(SOLANA_ACCOUNT);

    const queryLink = `${href}?cluster=devnet`;
    rerender(<OnchainLink href={queryLink}>Devnet account</OnchainLink>);
    const fallback = screen.getByRole("link", { name: "Devnet account" });
    expect(fallback).toHaveAttribute("href", queryLink);
    expect(fallback).not.toHaveAttribute("target");
  });

  it("accepts configured HTTPS explorers with valid path and identifier types", () => {
    expect(
      recognizeOnchainLink(`https://basescan.org/tx/${HASH}`),
    ).toMatchObject({ chainId: 8453, chainName: "Base" });
    expect(
      recognizeOnchainLink(`https://arbiscan.io/address/${ADDRESS}`),
    ).toMatchObject({ chainId: 42161 });
    for (const url of [
      `https://basescan.org/token/${ADDRESS}`,
      "https://basescan.org/block/123",
      `https://basescan.org/block/${HASH}`,
    ]) {
      expect(recognizeOnchainLink(url), url).toMatchObject({ chainId: 8453 });
    }
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
  });

  it("does not treat a local chain as a configured public explorer", () => {
    expect(
      recognizeOnchainLink(`https://local-explorer.test/tx/${HASH}`),
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
