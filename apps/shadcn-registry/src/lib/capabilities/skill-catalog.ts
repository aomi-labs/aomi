"use client";

import { useCallback, useEffect, useState } from "react";

export type SkillSummary = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  chainIds: number[];
  injectedTools: string[];
  estimatedTokens?: number;
};

export type SkillDetail = SkillSummary & {
  toolNames: string[];
  instructions: string;
  activation?: string;
};

const CATALOG_PATH = "/api/resource/skills?limit=100";
let cachedCatalog: SkillSummary[] | null = null;
let catalogRequest: Promise<SkillSummary[]> | null = null;

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
    chainIds: numbers(row.chain_ids),
    injectedTools: strings(row.injected_tools),
    ...(typeof row.est_tokens === "number"
      ? { estimatedTokens: row.est_tokens }
      : {}),
  };
}

function parseCatalog(value: unknown): SkillSummary[] {
  if (!value || typeof value !== "object") return [];
  const rows = (value as Record<string, unknown>).skills;
  if (!Array.isArray(rows)) return [];
  return rows
    .map(parseSkill)
    .filter((skill): skill is SkillSummary => skill !== null);
}

async function requestJson(path: string): Promise<unknown> {
  const response = await fetch(path, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<unknown>;
}

export async function fetchSkillCatalog(
  force = false,
): Promise<SkillSummary[]> {
  if (!force && cachedCatalog) return cachedCatalog;
  if (!force && catalogRequest) return catalogRequest;

  const request = requestJson(CATALOG_PATH)
    .then(parseCatalog)
    .then((skills) => {
      cachedCatalog = skills;
      return skills;
    })
    .finally(() => {
      if (catalogRequest === request) catalogRequest = null;
    });
  catalogRequest = request;
  return request;
}

export async function fetchSkillDetail(id: string): Promise<SkillDetail> {
  const value = await requestJson(
    `/api/resource/skills/${encodeURIComponent(id)}`,
  );
  const summary = parseSkill(value);
  if (!summary || !value || typeof value !== "object") {
    throw new Error("Skill details were not available.");
  }
  const row = value as Record<string, unknown>;
  return {
    ...summary,
    toolNames: strings(row.tool_names),
    instructions: typeof row.instructions === "string" ? row.instructions : "",
    ...(typeof row.activation === "string"
      ? { activation: row.activation }
      : {}),
  };
}

export function skillLabel(skill: Pick<SkillSummary, "name">): string {
  return skill.name
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

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

export function useSkillCatalog() {
  const [skills, setSkills] = useState<SkillSummary[] | null>(cachedCatalog);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setError(null);
    fetchSkillCatalog(revision > 0)
      .then((rows) => {
        if (active) setSkills(rows);
      })
      .catch(() => {
        if (active) {
          setSkills([]);
          setError("Couldn’t load skills.");
        }
      });
    return () => {
      active = false;
    };
  }, [revision]);

  const retry = useCallback(() => {
    cachedCatalog = null;
    catalogRequest = null;
    setSkills(null);
    setRevision((value) => value + 1);
  }, []);

  return { skills, error, retry, loading: skills === null };
}
