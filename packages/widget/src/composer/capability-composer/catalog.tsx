"use client";
import { useMemo } from "react";
import { AppWindowIcon, Globe2Icon, WandSparklesIcon } from "lucide-react";
import { isTestnetChain, shortAddress } from "@aomi-labs/client";
import { SUPPORTED_CHAINS, getChainInfo, useControl } from "@aomi-labs/react";
import {
  appName,
  familyTag,
  walletGroups,
} from "@/account/account-management/wallet-model";
import { resolveAppIdentity } from "@/lib/apps/app-identity";
import { evmNetworkDescription } from "@/controls/network-metadata";
import { getAppIcon } from "@/icons/app-map";
import { getChainIcon } from "@/icons/chain-map";
import { getSkillIcon } from "@/icons/skills/skill-icons";
import { SolanaIcon } from "@/icons/chain-icons";
import { useOptionalAomiWalletNetworkPreferences } from "@/wallet/network-preferences";
import { useAomiWalletKit } from "@/wallet/context";
import type { WalletRow } from "@/wallet/composer/wallet-state";
import {
  conciseSkillDescription,
  skillLabel,
  useSkillCatalog,
} from "@/composer/capabilities/skill-catalog";
import { useCapabilityComposer } from "./provider";
import { walletPickerIcon } from "./wallet-icon";
import type { PickerItem } from "./model";
import { resolveAutoModel } from "@/controls/model-metadata";

/**
 * The account's wallets as picker rows, from the wallet kit's list (the same
 * list as the backend's `[[WALLETS]]`, which leaves archived wallets out),
 * grouped as the account list groups them: a wallet with an EVM and an SVM
 * address is one row. The item id is the first address's `w_N` id and
 * `walletIds` holds every address's, which the model passes as `wallet_id`.
 */
export function walletPickerItems(rows: readonly WalletRow[]): PickerItem[] {
  const groups = walletGroups(
    rows.filter((row) => row.linked && row.linkedWalletId),
  );
  return groups.map(({ title, rows: own }) => {
    const walletIds = own.map((row) => `w_${row.linkedWalletId}`);
    const [first] = own;
    const app = appName(first!);
    return {
      key: `wallet:${walletIds[0]}`,
      kind: "wallet" as const,
      id: walletIds[0]!,
      walletIds,
      label: title,
      description:
        own.length > 1
          ? own.map((row) => shortAddress(row.address)).join(" · ")
          : `${shortAddress(first!.address)} · ${first!.kind === "agent" ? app : familyTag(first!.family)}`,
      // Not the family or app words: "solana" should find the chain first.
      searchText: `${title} ${own.map((row) => row.address).join(" ")}`,
      Icon: walletPickerIcon(app),
    };
  });
}

export function useCapabilityCatalog(): PickerItem[] {
  const { enabledAppIds, allowAppMentions } = useCapabilityComposer();
  const { state, getCurrentThreadControl } = useControl();
  const control = getCurrentThreadControl();
  const model =
    control.modelMode === "auto" || control.model === null
      ? resolveAutoModel(state.availableModels)
      : control.model;
  const networkPreferences = useOptionalAomiWalletNetworkPreferences();
  const { skills } = useSkillCatalog();
  const { wallets } = useAomiWalletKit();
  const enabled = useMemo(
    () => (enabledAppIds ? new Set(["default", ...enabledAppIds]) : null),
    [enabledAppIds],
  );
  const items = useMemo<PickerItem[]>(() => {
    const skillItems: PickerItem[] = (skills ?? []).map((skill) => ({
      key: `skill:${skill.id}`,
      kind: "skill",
      id: skill.id,
      label: skillLabel(skill),
      description: conciseSkillDescription(skill.description),
      fullDescription: skill.description,
      chainIds: skill.chainIds,
      searchText: `${skill.name} ${skill.description} ${skill.tags.join(" ")} ${skill.chainIds
        .map((chainId) => getChainInfo(chainId)?.name ?? chainId)
        .join(" ")}`,
      Icon: getSkillIcon(skill.id) ?? WandSparklesIcon,
    }));
    const appItems: PickerItem[] = allowAppMentions
      ? state.appDescriptors
          .filter(
            (app) =>
              app.name !== "orchestrator" &&
              (!enabled ||
                enabled.has(app.name) ||
                (app.isPublic === false && app.isInstalled === true)),
          )
          .map((app) => {
            const info = resolveAppIdentity(app);
            const metadata = app.metadata;
            const known =
              typeof metadata?.fundedModelOnly === "boolean" &&
              Array.isArray(metadata.sponsoredModelIds);
            const disabled =
              !known ||
              (metadata.fundedModelOnly === true &&
                (!model || !metadata.sponsoredModelIds?.includes(model)));
            const chainSearch = (app.chainIds ?? [])
              .map((chainId) => getChainInfo(chainId)?.name ?? chainId)
              .join(" ");
            const sourceId =
              app.applicationId !== null && app.applicationId !== undefined
                ? `application:${app.applicationId}`
                : `name:${app.name}`;
            return {
              key: `app:${sourceId}`,
              kind: "app" as const,
              id: sourceId,
              label: info.displayName,
              description: !known
                ? "Checking model availability…"
                : disabled
                  ? "Choose a sponsored model"
                  : info.category.label,
              disabled,
              chainIds: app.chainIds,
              applicationId: app.applicationId,
              appName: app.name,
              searchText: `${app.name} ${app.label ?? ""} ${info.displayName} ${info.category.label} ${chainSearch}`,
              Icon: getAppIcon(info.brandId) ?? AppWindowIcon,
            };
          })
      : [];
    const evmChains =
      networkPreferences?.supportedEvmChains ?? SUPPORTED_CHAINS;
    const chainItems: PickerItem[] = [
      ...evmChains.map((chain) => ({
        key: `chain:eip155:${chain.id}`,
        kind: "chain" as const,
        id: `eip155:${chain.id}`,
        label: chain.name,
        description: evmNetworkDescription(chain),
        chainTarget: { family: "evm" as const, chainId: chain.id },
        searchText: `${chain.name} evm ${chain.id}`,
        testnet: isTestnetChain(chain),
        Icon: getChainIcon(chain.id) ?? Globe2Icon,
      })),
      ...(networkPreferences?.supportedSolanaNetworks ?? []).map((network) => ({
        key: `chain:solana:${network.id}`,
        kind: "chain" as const,
        id: `solana:${network.id}`,
        label: network.label,
        description: `Solana network · ${network.cluster.replace("solana:", "")}`,
        chainTarget: {
          family: "svm" as const,
          networkId: network.id,
        },
        searchText: `${network.label} solana svm ${network.id}`,
        testnet: network.cluster !== "solana:mainnet",
        Icon: SolanaIcon,
      })),
    ];
    return [
      ...appItems,
      ...skillItems,
      ...chainItems,
      ...walletPickerItems(wallets),
    ];
  }, [
    allowAppMentions,
    enabled,
    networkPreferences,
    skills,
    state.appDescriptors,
    model,
    wallets,
  ]);

  return items;
}
