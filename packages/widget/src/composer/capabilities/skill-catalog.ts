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

/** The public skill catalog: credential-free, so every viewer shares it. */
export function skillCatalogQuery(aomi: Aomi): DisplayQuery<SkillSummary[]> {
  return {
    resource: "skills",
    fetcher: (signal) =>
      aomi.raw.getPublicCatalog("skills", { signal }).then(parseSkillCatalog),
  };
}

const NONE: SkillSummary[] = [];

/** The built-in skills, for attributing trace steps; empty until loaded. */
export function useSkillCatalog(): SkillSummary[] {
  return useDisplayQuery(skillCatalogQuery(useAomi())).data ?? NONE;
}
