"use client";
import { useMemo, useState, type FC } from "react";
import {
  AppWindowIcon,
  Globe2Icon,
  PackageIcon,
  WandSparklesIcon,
} from "lucide-react";
import {
  isTestnetChain,
  packageMentions,
  shortAddress,
  type AomiPackage,
} from "@aomi-labs/client";
import {
  SUPPORTED_CHAINS,
  getChainInfo,
  useControl,
  useOptionalAomiRuntime,
} from "@aomi-labs/react";
import { useAccountOverview } from "@/account/account-overview";
import { brandId } from "@/library/model";
import { usePackageCatalog } from "@/library/use-package-catalog";
import {
  walletName,
  familyTag,
  walletGroups,
} from "@/account/account-management/wallet-model";
import { resolveAgentIdentity } from "@aomi-labs/client";
import { evmNetworkDescription } from "@/controls/network-metadata";
import { getAgentIcon } from "@/icons/agent-map";
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
    const agent = walletName(first!);
    return {
      key: `wallet:${walletIds[0]}`,
      kind: "wallet" as const,
      id: walletIds[0]!,
      walletIds,
      label: title,
      description:
        own.length > 1
          ? own.map((row) => shortAddress(row.address)).join(" · ")
          : `${shortAddress(first!.address)} · ${first!.kind === "agent" ? agent : familyTag(first!.family)}`,
      // Not the family or agent words: "solana" should find the chain first.
      searchText: `${title} ${own.map((row) => row.address).join(" ")}`,
      Icon: walletPickerIcon(agent),
    };
  });
}

/** A package's icon at picker size: its own image, else its brand mark or a box. */
function packageIcon(row: AomiPackage): FC<{ className?: string }> {
  const Fallback = getAgentIcon(brandId(row)) ?? PackageIcon;
  const src = row.icon_url;
  if (!src) return Fallback;
  return function PackageImage({ className }) {
    const [failed, setFailed] = useState(false);
    return failed ? (
      <Fallback className={className} />
    ) : (
      <img
        src={src}
        alt=""
        onError={() => setFailed(true)}
        className={`${className ?? ""} rounded-[4px] object-cover`}
      />
    );
  };
}

/** The packages on in this chat as picker rows (`packageMentions`), with their icons. */
export function packagePickerItems(rows: readonly AomiPackage[]): PickerItem[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return packageMentions(rows).map((item) => {
    const row = byId.get(item.id)!;
    return {
      ...item,
      key: `package:${item.id}`,
      fullDescription: row.description,
      Icon: packageIcon(row),
    };
  });
}

/** The Library's rows for this chat's agent (a guest's are the defaults), as picker rows. */
export function usePackagePickerItems(): PickerItem[] {
  const accountUserId = useAccountOverview()?.user.user_id;
  const runtime = useOptionalAomiRuntime();
  // A chat the server has not stored yet reads `aomi/main`'s rows, as the Library does.
  const threadId =
    runtime && runtime.isRemoteThread?.(runtime.currentThreadId)
      ? runtime.currentThreadId
      : undefined;
  const { catalog } = usePackageCatalog(accountUserId, threadId);
  return useMemo(() => packagePickerItems(catalog?.packages ?? []), [catalog]);
}

export function useCapabilityCatalog(): PickerItem[] {
  const { allowAgentMentions } = useCapabilityComposer();
  const { state, getCurrentThreadControl } = useControl();
  const control = getCurrentThreadControl();
  const model =
    control.modelMode === "auto" || control.model === null
      ? resolveAutoModel(state.availableModels)
      : control.model;
  const networkPreferences = useOptionalAomiWalletNetworkPreferences();
  const { skills } = useSkillCatalog();
  const packageItems = usePackagePickerItems();
  const { wallets } = useAomiWalletKit();
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
    const agentItems: PickerItem[] = allowAgentMentions
      ? state.agentCards.map((agent) => {
          const info = resolveAgentIdentity(agent);
          const metadata = agent.metadata;
          const known =
            typeof metadata?.fundedModelOnly === "boolean" &&
            Array.isArray(metadata.sponsoredModelIds);
          const disabled =
            !known ||
            (metadata.fundedModelOnly === true &&
              (!model ||
                !(metadata.sponsoredModelIds as string[]).includes(model)));
          const chainSearch = "";
          const sourceId = `agent:${agent.agent}`;
          return {
            key: `agent:${sourceId}`,
            kind: "agent" as const,
            id: sourceId,
            label: info.displayName,
            description: !known
              ? "Checking model availability…"
              : disabled
                ? "Choose a sponsored model"
                : info.category.label,
            disabled,
            agentName: agent.agent,
            searchText: `${agent.agent} ${agent.display_name ?? ""} ${info.displayName} ${info.category.label} ${chainSearch}`,
            Icon: getAgentIcon(info.brandId) ?? AppWindowIcon,
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
      ...agentItems,
      ...packageItems,
      ...skillItems,
      ...chainItems,
      ...walletPickerItems(wallets),
    ];
  }, [
    allowAgentMentions,
    networkPreferences,
    packageItems,
    skills,
    state.agentCards,
    model,
    wallets,
  ]);

  return items;
}
