import { useId, type FC, type SVGProps } from "react";
import { CoinsIcon } from "lucide-react";

type SkillIconProps = SVGProps<SVGSVGElement>;

/** Published Krexa artwork; a raster exception until an official vector is available. */
export function KrexaSkillIcon(props: SkillIconProps) {
  const maskId = useId();
  return (
    <svg
      viewBox="21 19 86 86"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      <defs>
        <mask
          id={maskId}
          style={{ maskType: "alpha" }}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="120"
          height="120"
        >
          <image
            href="data:image/webp;base64,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"
            width="120"
            height="120"
          />
        </mask>
      </defs>
      <rect
        x="0"
        y="0"
        width="120"
        height="120"
        fill="currentColor"
        mask={`url(#${maskId})`}
      />
    </svg>
  );
}

/**
 * Marks for the built-in skills. A hosted package never has an entry here:
 * it draws its own `icon_url` (`PackageMark`). Any other id returns
 * `undefined` so the caller uses its neutral fallback.
 */
const SKILL_ICONS: Record<string, FC<SVGProps<SVGSVGElement>>> = {
  krexa: KrexaSkillIcon,
  // Common ERC-20 and SPL Token expose standard token operations, so reuse the
  // same coin mark shown for unknown assets in transaction and trace UI.
  common_erc20: CoinsIcon,
  spl_token: CoinsIcon,
};

/** Normalize a capability catalog ID before looking up its visual identity. */
export function normalizeSkillId(skillId: string): string {
  return skillId
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/gu, "_");
}

export function getSkillIcon(
  skillId: string | null | undefined,
): FC<SVGProps<SVGSVGElement>> | undefined {
  if (!skillId) return undefined;
  return Object.hasOwn(SKILL_ICONS, normalizeSkillId(skillId))
    ? SKILL_ICONS[normalizeSkillId(skillId)]
    : undefined;
}
