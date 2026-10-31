"use client";

export {
  conciseSkillDescription,
  parseSkillCatalog,
  skillLabel,
  type SkillSummary,
} from "@aomi-labs/client";

import { useDisplayQuery, type DisplayQuery } from "@aomi-labs/react";
import {
  parseSkillCatalog,
  type Aomi,
  type SkillSummary,
} from "@aomi-labs/client";
import { useAomi } from "@/account/transport";

/** The pipeline operations a skill offers, beside the tools it injects. */
export async function fetchSkillOperations(
  aomi: Aomi,
  id: string,
): Promise<string[]> {
  const { entries } = await aomi.pipeline.skill(id).operations();
  return entries.map((entry) => entry.name);
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
