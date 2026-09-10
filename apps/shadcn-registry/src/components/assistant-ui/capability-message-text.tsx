"use client";

import { useMessage, type TextMessagePartComponent } from "@assistant-ui/react";
import { AppWindowIcon, Globe2Icon, WandSparklesIcon } from "lucide-react";
import { useMemo, type FC } from "react";
import { SUPPORTED_CHAINS, getChainInfo, useControl } from "@aomi-labs/react";

import { resolveAppIdentity } from "../../lib/apps/app-identity";
import {
  getAppIcon,
  getChainIcon,
  getSkillIcon,
  SolanaIcon,
} from "@/components/icons";
import {
  skillLabel,
  useSkillCatalog,
} from "../../lib/capabilities/skill-catalog";
import { useOptionalAomiWalletNetworkPreferences } from "../../lib/wallet-kit/network-preferences";

type CapabilityHint = {
  kind: "app" | "skill" | "chain";
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
      (candidate.kind === "app" ||
        candidate.kind === "skill" ||
        candidate.kind === "chain") &&
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
): CapabilityTextSegment[] {
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

  const capabilities = useMemo<RenderedCapability[]>(() => {
    const catalogHints: CapabilityHint[] = [
      ...state.appDescriptors.map((app) => ({
        kind: "app" as const,
        id:
          app.applicationId === null || app.applicationId === undefined
            ? `name:${app.name}`
            : `application:${app.applicationId}`,
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
    ];
    const seen = new Set<string>();
    return [...hints, ...catalogHints].flatMap((hint) => {
      const identity = `${hint.kind}:${hint.id}`;
      if (seen.has(identity)) return [];
      seen.add(identity);
      if (hint.kind === "app") {
        const descriptor = hint.id.startsWith("application:")
          ? state.appDescriptors.find(
              (app) =>
                String(app.applicationId) ===
                hint.id.slice("application:".length),
            )
          : state.appDescriptors.find(
              (app) => app.name === hint.id.replace(/^name:/u, ""),
            );
        const appName = descriptor?.name ?? hint.id.replace(/^name:/u, "");
        const info = resolveAppIdentity(descriptor ?? appName);
        const label = info.displayName;
        return [
          {
            ...hint,
            label,
            token: `▦ ${label}`,
            Icon: getAppIcon(info.brandId) ?? AppWindowIcon,
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
  }, [hints, networkPreferences, skills, state.appDescriptors]);
  const segments = useMemo(
    () => splitCapabilityText(text, capabilities),
    [capabilities, text],
  );

  return (
    <span className="whitespace-pre-wrap">
      {segments.map((segment, index) =>
        segment.type === "text" ? (
          <span key={`text-${index}`}>{segment.text}</span>
        ) : (
          <span
            key={`${segment.capability.kind}-${segment.capability.id}-${index}`}
            className="text-aomi-accent relative top-px mx-0.5 inline-flex items-center gap-1 whitespace-nowrap align-baseline font-medium"
          >
            <segment.capability.Icon
              aria-hidden="true"
              className="size-3.5 shrink-0"
            />
            {segment.capability.label}
          </span>
        ),
      )}
    </span>
  );
};
