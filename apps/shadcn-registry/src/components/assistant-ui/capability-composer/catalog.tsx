"use client";
import { useMemo } from "react";
import { AppWindowIcon, Globe2Icon, WandSparklesIcon } from "lucide-react";
import { SUPPORTED_CHAINS, getChainInfo, useControl } from "@aomi-labs/react";
import { resolveAppIdentity } from "../../../lib/apps/app-identity";
import { evmNetworkDescription } from "@/components/control-bar/network-metadata";
import {
  getAppIcon,
  getChainIcon,
  getSkillIcon,
  SolanaIcon,
} from "@/components/icons";
import { useOptionalAomiWalletNetworkPreferences } from "../../../lib/wallet-kit/network-preferences";
import {
  conciseSkillDescription,
  skillLabel,
  useSkillCatalog,
} from "../../../lib/capabilities/skill-catalog";
import { useCapabilityComposer } from "./provider";
import type { PickerItem } from "./model";

export function useCapabilityCatalog(): PickerItem[] {
  const { enabledAppIds, allowAppMentions } = useCapabilityComposer();
  const { state } = useControl();
  const networkPreferences = useOptionalAomiWalletNetworkPreferences();
  const { skills } = useSkillCatalog();
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
              (!enabled || enabled.has(app.name)),
          )
          .map((app) => {
            const info = resolveAppIdentity(app);
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
              description: info.category.label,
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
        Icon: SolanaIcon,
      })),
    ];
    return [...appItems, ...skillItems, ...chainItems];
  }, [
    allowAppMentions,
    enabled,
    networkPreferences,
    skills,
    state.appDescriptors,
  ]);

  return items;
}
