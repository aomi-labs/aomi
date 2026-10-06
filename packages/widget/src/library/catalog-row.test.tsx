import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { toCatalogPackage } from "../packages-catalog";
import { CatalogRow } from "./catalog-row";

const ARC_TESTNET = 5_042_002;

const renderRow = (hostChainIds: readonly number[], chainIds = [ARC_TESTNET]) =>
  render(
    <CatalogRow
      selection={{
        kind: "app",
        item: toCatalogPackage({ name: "stablefx", chainIds }),
      }}
      selected={false}
      installed={false}
      busy={false}
      disabled={false}
      hostChainIds={hostChainIds}
      onSelect={() => undefined}
      onInstall={() => undefined}
      onTry={() => undefined}
    />,
  );

afterEach(cleanup);

describe("catalog row availability", () => {
  it("offers a chain-scoped app when the host supports one of its chains", () => {
    // Whatever chain the wallet is on: the host routes to Arc Testnet.
    renderRow([1, 8453, ARC_TESTNET]);
    expect(
      screen.getByLabelText("Add Circle StableFX from catalog"),
    ).toBeEnabled();
    expect(screen.getByText("Arc only")).toBeTruthy();
  });

  it("blocks a chain-scoped app the host has no network for", () => {
    renderRow([1, 8453]);
    expect(
      screen.getByLabelText(
        "Circle StableFX needs a network this site doesn't support",
      ),
    ).toBeDisabled();
  });

  it("offers an app that declares no chains on any host", () => {
    renderRow([], []);
    expect(
      screen.getByLabelText("Add Circle StableFX from catalog"),
    ).toBeEnabled();
  });
});
