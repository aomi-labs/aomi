"use client";

import { useMemo } from "react";
import type { AomiPolicyEnforcement } from "@aomi-labs/client";
import { useAomiWalletKit } from "@/wallet/context";
import { viemVaultReader, type VaultReader } from "./vault-chain";
import type { PolicyCatalog } from "./policy-model";
import { VaultRow } from "./vault-row";
import { vaultTokens, vaultsOf } from "./vault-model";
import { vaultSigner, withdrawFromVault } from "./vault-withdraw-flow";

export function WalletVaultRows({
  enforcement,
  catalog,
  reader,
}: {
  enforcement: readonly AomiPolicyEnforcement[];
  catalog: PolicyCatalog | null;
  reader?: VaultReader;
}) {
  const kit = useAomiWalletKit();
  const chain = useMemo(
    () => reader ?? viemVaultReader(kit.supportedChains),
    [reader, kit.supportedChains],
  );
  return (
    <>
      {vaultsOf(enforcement).map((vault) => (
        <VaultRow
          key={vault.key}
          vault={vault}
          tokens={vaultTokens(catalog, vault.chain.network)}
          readBalances={(tokens) =>
            chain.balances(vault.chainId, vault.address, tokens)
          }
          withdraw={(asset, amount) =>
            withdrawFromVault(kit, chain, { vault, asset, amount })
          }
          signer={vaultSigner(kit, vault.owner)}
        />
      ))}
    </>
  );
}
