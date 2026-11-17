"use client";

import { useMessage, type TextMessagePartComponent } from "@assistant-ui/react";
import { AppWindowIcon, Globe2Icon, WandSparklesIcon } from "lucide-react";
import { useMemo, type FC } from "react";
import { SUPPORTED_CHAINS, getChainInfo, useControl } from "@aomi-labs/react";

import { resolveAgentIdentity } from "@aomi-labs/client";
import { getAgentIcon } from "@/icons/agent-map";
import { getChainIcon } from "@/icons/chain-map";
import { getSkillIcon } from "@/icons/skills/skill-icons";
import { SolanaIcon } from "@/icons/chain-icons";
import {
  skillLabel,
  useSkillCatalog,
} from "@/composer/capabilities/skill-catalog";
import { useOptionalAomiWalletNetworkPreferences } from "@/wallet/network-preferences";
import { useAomiWalletKit } from "@/wallet/context";
import { walletPickerItems } from "@/composer/capability-composer/catalog";

type CapabilityHint = {
  kind: "agent" | "skill" | "chain" | "wallet";
  id: string;
};

export type RenderedCapability = CapabilityHint & {
  label: string;
  token: string;
  Icon: FC<{ className?: string }>;
};

export type CapabilityTextSegment =
  | { type: "text"; text: string }
  | { type: "capability"; capability: RenderedCapability };

function capabilityHints(value: unknown): CapabilityHint[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is CapabilityHint => {
    if (!item || typeof item !== "object") return false;
    const candidate = item as Record<string, unknown>;
    return (
      (candidate.kind === "agent" ||
        candidate.kind === "skill" ||
        candidate.kind === "chain" ||
        candidate.kind === "wallet") &&
      typeof candidate.id === "string"
    );
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function splitCapabilityText(
  text: string,
  capabilities: readonly RenderedCapability[],
  selected: readonly CapabilityHint[] = [],
): CapabilityTextSegment[] {
  const missingAgents = capabilities.filter(
    (capability) =>
      capability.kind === "agent" &&
      selected.some(
        (hint) => hint.kind === "agent" && hint.id === capability.id,
      ) &&
      !text.includes(capability.token),
  );
  text = [...missingAgents.map((agent) => agent.token), text].join(" ");
  const byToken = new Map(
    capabilities.map((capability) => [capability.token, capability]),
  );
  const tokens = [...byToken.keys()].sort(
    (left, right) => right.length - left.length,
  );
  if (tokens.length === 0) return [{ type: "text", text }];

  const matcher = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "gu");
  return text
    .split(matcher)
    .filter(Boolean)
    .map((part) => {
      const capability = byToken.get(part);
      return capability
        ? { type: "capability" as const, capability }
        : { type: "text" as const, text: part };
    });
}

export const CapabilityMessageText: TextMessagePartComponent = ({ text }) => {
  const rawHints = useMessage((state) => {
    const custom = state.metadata?.custom as
      | { aomiCapabilityHints?: unknown }
      | undefined;
    return custom?.aomiCapabilityHints;
  });
  const hints = useMemo(() => capabilityHints(rawHints), [rawHints]);
  const { state } = useControl();
  const { skills } = useSkillCatalog();
  const networkPreferences = useOptionalAomiWalletNetworkPreferences();
  const { wallets } = useAomiWalletKit();

  const capabilities = useMemo<RenderedCapability[]>(() => {
    const walletItems = walletPickerItems(wallets);
    const catalogHints: CapabilityHint[] = [
      ...state.agentCards.map((agent) => ({
        kind: "agent" as const,
        id: `agent:${agent.agent}`,
      })),
      ...(skills ?? []).map((skill) => ({
        kind: "skill" as const,
        id: skill.id,
      })),
      ...(networkPreferences?.supportedEvmChains ?? SUPPORTED_CHAINS).map(
        (chain) => ({ kind: "chain" as const, id: `eip155:${chain.id}` }),
      ),
      ...(networkPreferences?.supportedSolanaNetworks ?? []).map((network) => ({
        kind: "chain" as const,
        id: `solana:${network.id}`,
      })),
      ...walletItems.flatMap(({ id, walletIds }) =>
        (walletIds ?? [id]).map((walletId) => ({
          kind: "wallet" as const,
          id: walletId,
        })),
      ),
    ];
    const seen = new Set<string>();
    return [...hints, ...catalogHints].flatMap((hint) => {
      const identity = `${hint.kind}:${hint.id}`;
      if (seen.has(identity)) return [];
      seen.add(identity);
      if (hint.kind === "agent") {
        const slug = hint.id.replace(/^agent:/u, "");
        const descriptor = state.agentCards.find(
          (agent) => agent.agent === slug,
        );
        const agentName = descriptor?.agent ?? slug;
        const info = resolveAgentIdentity(descriptor ?? agentName);
        const label = info.displayName;
        return [
          {
            ...hint,
            label,
            token: `▦ ${label}`,
            Icon: getAgentIcon(info.brandId) ?? AppWindowIcon,
          },
        ];
      }

      if (hint.kind === "skill") {
        const skill = skills?.find((candidate) => candidate.id === hint.id);
        if (!skill) return [];
        const label = skillLabel(skill);
        return [
          {
            ...hint,
            label,
            token: `✦ ${label}`,
            Icon: getSkillIcon(skill.id) ?? WandSparklesIcon,
          },
        ];
      }

      if (hint.kind === "wallet") {
        const wallet = walletItems.find((item) =>
          (item.walletIds ?? [item.id]).includes(hint.id),
        );
        if (!wallet) return [];
        return [
          {
            ...hint,
            label: wallet.label,
            token: `◈ ${wallet.label}`,
            Icon: wallet.Icon,
          },
        ];
      }

      if (hint.id.startsWith("eip155:")) {
        const chainId = Number(hint.id.slice("eip155:".length));
        const chain = getChainInfo(chainId);
        if (!chain) return [];
        return [
          {
            ...hint,
            label: chain.name,
            token: `◇ ${chain.name}`,
            Icon: getChainIcon(chainId) ?? Globe2Icon,
          },
        ];
      }

      const networkId = hint.id.replace(/^solana:/u, "");
      const network = networkPreferences?.supportedSolanaNetworks.find(
        (candidate) => candidate.id === networkId,
      );
      if (!network) return [];
      return [
        {
          ...hint,
          label: network.label,
          token: `◇ ${network.label}`,
          Icon: SolanaIcon,
        },
      ];
    });
  }, [hints, networkPreferences, skills, state.agentCards, wallets]);
  const segments = useMemo(
    () => splitCapabilityText(text, capabilities, hints),
    [capabilities, hints, text],
  );

  return (
    <span className="whitespace-pre-wrap">
      {segments.map((segment, index) =>
        segment.type === "text" ? (
          <span key={`text-${index}`}>{segment.text}</span>
        ) : (
          <span
            key={`${segment.capability.kind}-${segment.capability.id}-${index}`}
            // Plain inline text on the line's baseline; an inline-flex box
            // would take its baseline from the icon and ride high.
            className="text-aomi-accent mx-0.5 whitespace-nowrap font-medium"
          >
            <segment.capability.Icon
              aria-hidden="true"
              className="mr-1 inline-block size-3.5 align-[-0.175em]"
            />
            {segment.capability.label}
          </span>
        ),
      )}
    </span>
  );
};
