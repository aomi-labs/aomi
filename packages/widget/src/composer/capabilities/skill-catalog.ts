"use client";

export type SkillSummary = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  featureCatalog: string[];
  chainIds: number[];
  injectedTools: string[];
  estimatedTokens?: number;
};

import { useDisplayQuery, type DisplayQuery } from "@aomi-labs/react";
import type { Aomi } from "@aomi-labs/client";
import { useAomi } from "@/account/transport";

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function numbers(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is number =>
          typeof item === "number" && Number.isFinite(item),
      )
    : [];
}

function parseSkill(value: unknown): SkillSummary | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.name !== "string") return null;
  return {
    id: row.id,
    name: row.name,
    description: typeof row.description === "string" ? row.description : "",
    tags: strings(row.tags),
    featureCatalog: strings(row.feature_catalog),
    chainIds: numbers(row.chain_ids),
    injectedTools: strings(row.injected_tools),
    ...(typeof row.est_tokens === "number"
      ? { estimatedTokens: row.est_tokens }
      : {}),
  };
}

export function parseSkillCatalog(value: unknown): SkillSummary[] {
  if (!value || typeof value !== "object") return [];
  const rows = (value as Record<string, unknown>).skills;
  if (!Array.isArray(rows)) return [];
  return rows
    .map(parseSkill)
    .filter((skill): skill is SkillSummary => skill !== null);
}

/** The pipeline operations a skill offers, beside the tools it injects. */
export async function fetchSkillOperations(
  aomi: Aomi,
  id: string,
): Promise<string[]> {
  const { entries } = await aomi.pipeline.skill(id).operations();
  return entries.map((entry) => entry.name);
}

export { skillLabel } from "./skill-label";

const CHAIN_CONTEXT =
  /\s+(?:on|from|across)\s+(?:Ethereum|Arbitrum(?: One)?|Optimism|OP Mainnet|Polygon|Base|Linea|Monad|MegaETH|Robinhood|Solana)\b.*$/iu;

/** Turn registry prose into a quiet one-line capability summary for pickers. */
export function conciseSkillDescription(description: string): string {
  const original = description.trim();
  if (!original) return "";

  let summary = original
    .split(/\n|(?<=[.!?])\s/u, 1)[0]!
    .replace(
      /^use (?:this skill )?when (?:the )?users? (?:want|wants|need|needs) (?:to\s+)?/iu,
      "",
    )
    .replace(/\s+[—;].*$/u, "")
    .replace(/\s+via\s+.*$/iu, "")
    .replace(CHAIN_CONTEXT, "")
    .replace(/\bERC20\b/giu, "ERC-20")
    .replace(/[.!?]+$/u, "")
    .trim();

  if (!summary) summary = original;
  summary = `${summary[0]?.toUpperCase() ?? ""}${summary.slice(1)}`;
  if (summary.length <= 64) return summary;

  const boundary = summary.lastIndexOf(" ", 61);
  return `${summary.slice(0, boundary >= 42 ? boundary : 61).trimEnd()}…`;
}

/** The public skill catalog: credential-free, so every viewer shares it. */
export function skillCatalogQuery(aomi: Aomi): DisplayQuery<SkillSummary[]> {
  return {
    resource: "skills",
    fetcher: (signal) =>
      aomi.raw.getPublicCatalog("skills", { signal }).then(parseSkillCatalog),
  };
}

export function useSkillCatalog() {
  const query = useDisplayQuery(skillCatalogQuery(useAomi()));
  return {
    skills: query.data ?? (query.error ? [] : null),
    error: query.error ? "Couldn’t load skills." : null,
    retry: () => {
      void query.refetch();
    },
    loading: query.isPending,
  };
}
