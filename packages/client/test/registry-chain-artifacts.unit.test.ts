import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readRegistryArtifact(path: string): string {
  const payload = JSON.parse(readFileSync(resolve(path), "utf8")) as {
    files?: Array<{ path?: string; content?: string }>;
  };
  return payload.files?.map((file) => file.content ?? "").join("\n") ?? "";
}

describe("registry chain artifacts", () => {
  it("publishes Monad, Robinhood, MegaETH, and Arc in the installable wallet kit", () => {
    const kitSource = readRegistryArtifact(
      "apps/landing/public/r/aomi-wallet-kit.json",
    );
    const providerSource = readRegistryArtifact(
      "apps/landing/public/r/aomi-para-provider.json",
    );
    const privyProviderSource = readRegistryArtifact(
      "apps/landing/public/r/aomi-privy-provider.json",
    );

    expect(kitSource).toContain("monad");
    expect(kitSource).toContain("monadTestnet");
    expect(kitSource).toContain("robinhood");
    expect(kitSource).toContain("megaeth");
    expect(kitSource).toContain("arcTestnet");
    expect(kitSource).toContain("arc,");
    expect(privyProviderSource).toContain("megaeth");
    expect(privyProviderSource).toContain("arcTestnet");
    expect(privyProviderSource).toContain("arc,");
    expect(providerSource).toContain("supportedChains={supportedChains}");
  });
});
