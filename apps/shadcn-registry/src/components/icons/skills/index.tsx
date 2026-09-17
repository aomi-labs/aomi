import { useId, type FC, type SVGProps } from "react";
import { CoinsIcon, FlaskConicalIcon } from "lucide-react";

import {
  AcrossIcon,
  LifiIcon,
  MorphoIcon,
  OneInchIcon,
  YearnIcon,
} from "../apps";
import { ArbitrumIcon, BaseIcon, OptimismIcon, RobinhoodIcon } from "../chains";

import { sourcedSkillMarks } from "./sourced-marks";

type SkillIconProps = SVGProps<SVGSVGElement>;

/** Static, reviewed SVG geometry shared by every skill surface. */
function SourcedSkillIcon({
  mark,
  ...props
}: SkillIconProps & { mark: keyof typeof sourcedSkillMarks }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
      dangerouslySetInnerHTML={{ __html: sourcedSkillMarks[mark] }}
    />
  );
}

/**
 * Official marks used by the capability picker.
 *
 * These are monochrome; Krexa uses its published raster as an alpha mask. The picker supplies `currentColor`, so
 * the same source mark stays legible in the muted and active states.
 */

// Source: https://github.com/aave-dao/aave-brand-kit/tree/main/Logo
export function AaveSkillIcon(props: SkillIconProps) {
  return (
    <svg
      viewBox="-26.5600 -90.0935 318.7200 318.7200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      <path
        d="M97.5418 138.533C112.461 138.533 124.556 126.438 124.556 111.518C124.556 96.5987 112.461 84.5039 97.5418 84.5039C82.6221 84.5039 70.5273 96.5987 70.5273 111.518C70.5273 126.438 82.6221 138.533 97.5418 138.533Z"
        fill="currentColor"
      />
      <path
        d="M168.149 138.533C183.069 138.533 195.164 126.438 195.164 111.518C195.164 96.5987 183.069 84.5039 168.149 84.5039C153.23 84.5039 141.135 96.5987 141.135 111.518C141.135 126.438 153.23 138.533 168.149 138.533Z"
        fill="currentColor"
      />
      <path
        d="M132.8 0C59.4497 0-.0192 60.6017 0 135.335H33.9264C33.9264 79.3281 77.8433 33.92 132.8 33.92C187.757 33.92 231.674 79.3281 231.674 135.335H265.6C265.613 60.6017 206.144 0 132.8 0Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Across Protocol mark. Source: https://across.to/ */
export function AcrossSkillIcon(props: SkillIconProps) {
  return <AcrossIcon viewBox="-4.0000 -4.0000 48.0000 48.0000" {...props} />;
}

/** Source and presentation notes: assets/README.md. */
export function AerodromeSkillIcon(props: SkillIconProps) {
  return <SourcedSkillIcon mark="aerodrome" {...props} />;
}

/** Source and presentation notes: assets/README.md. */
export function CurveSkillIcon(props: SkillIconProps) {
  return <SourcedSkillIcon mark="curve" {...props} />;
}

/** Source and presentation notes: assets/README.md. */
export function EtherfiSkillIcon(props: SkillIconProps) {
  return <SourcedSkillIcon mark="etherfi" {...props} />;
}

/** Compound's three-bar protocol mark, cropped from the official wordmark. Source: https://compound.finance/images/compound-logo.svg */
export function CompoundSkillIcon(props: SkillIconProps) {
  return (
    <svg
      viewBox="-5.6024 -2.6906 32.3387 32.3387"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      <path
        d="m1.084 21.043 9.461 5.79a1.2 1.2 0 0 0 1.723-1.047v-4.47a1.9 1.9 0 0 0-.936-1.63L1.42 13.908A.95.95 0 0 0 0 14.72v4.393c0 .787.411 1.519 1.084 1.93M15.858 12.704l-9.909-5.778a.95.95 0 0 0-1.42.813v5.787l8.705 5.208a1.9 1.9 0 0 1 .918 1.62v5.127l2.258-1.257a.95.95 0 0 0 .384-.657v-9.233a1.9 1.9 0 0 0-.936-1.63M20.195 5.885l-9.908-5.758a.95.95 0 0 0-1.417.817v5.49l8.897 5.337a1.9 1.9 0 0 1 .915 1.618v9.389l2.056-1.11a.95.95 0 0 0 .396-.664V7.517a1.9 1.9 0 0 0-.939-1.632"
        fill="currentColor"
      />
    </svg>
  );
}

/** Source and presentation notes: assets/README.md. */
export function ConvexSkillIcon(props: SkillIconProps) {
  return <SourcedSkillIcon mark="convex" {...props} />;
}

/** Source and presentation notes: assets/README.md. */
export function KaminoSkillIcon(props: SkillIconProps) {
  return <SourcedSkillIcon mark="kamino" {...props} />;
}

/** The bridge skill uses Arbitrum's official chain mark. */
export function ArbitrumBridgeSkillIcon(props: SkillIconProps) {
  return <ArbitrumIcon viewBox="1.2006 1.2001 21.5989 21.5989" {...props} />;
}

/** The canonical Base bridge skill uses the official Base mark. */
export function BaseNativeSkillIcon(props: SkillIconProps) {
  return <BaseIcon viewBox="1.2000 1.2000 21.6000 21.6000" {...props} />;
}

// Source: https://developers.jup.ag/docs/resources/brand-kit
export function JupiterSkillIcon(props: SkillIconProps) {
  return (
    <svg
      viewBox="-3.2285 -3.4268 38.7420 38.7420"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      <path
        d="M3.091 25.167c1.352 1.88 3.085 3.454 5.088 4.617 2.003 1.163 4.229 1.89 6.532 2.133-1.185-1.783-2.908-3.424-5.058-4.673-2.15-1.249-4.428-1.932-6.562-2.077"
        fill="currentColor"
      />
      <path
        d="M12.543 22.27C8.4 19.864 3.916 19.25.708 20.334c.31 1.024.718 2.015 1.22 2.96 2.787-.065 5.83.692 8.662 2.337 2.832 1.645 4.998 3.915 6.324 6.369a20 20 0 0 0 3.177-.407c-.649-3.324-3.407-6.916-7.548-9.323"
        fill="currentColor"
        opacity=".68"
      />
      <path
        d="M32.285 12.501A16 16 0 0 0 11.846.626c3.546.434 7.48 1.765 11.34 4.007 3.86 2.242 6.967 5 9.099 7.868"
        fill="currentColor"
        opacity=".42"
      />
      <path
        d="M27.127 20.358c-1.815-3.013-4.923-5.899-8.753-8.124C14.545 10.01 10.499 8.738 6.985 8.655c-3.09-.073-5.411.825-6.364 2.465l-.019.029a20 20 0 0 0-.228.925c1.33-.525 2.87-.818 4.585-.85 3.81-.072 8.073 1.147 12.008 3.433 3.935 2.286 7.107 5.388 8.932 8.732.818 1.506 1.328 2.99 1.53 4.407.236-.211.467-.428.691-.654l.016-.032c.953-1.641.585-4.101-.989-6.752"
        fill="currentColor"
        opacity=".82"
      />
      <path
        d="M15.461 17.249C9.597 13.842 3.116 13.308 0 15.686c.006.744.063 1.487.17 2.223a15 15 0 0 1 2.817-.522c3.482-.262 7.322.708 10.806 2.733 3.484 2.025 6.23 4.88 7.728 8.034.414.863.73 1.77.941 2.705a20 20 0 0 0 2.017-.953c.522-3.885-3.153-9.25-9.018-12.657"
        fill="currentColor"
        opacity=".58"
      />
      <path
        d="M30.143 15.314c-1.835-3.011-4.971-5.905-8.827-8.144-3.857-2.24-7.919-3.53-11.444-3.633-2.687-.078-4.769.573-5.848 1.804 4.481-.759 10.392.517 16.121 3.845 5.729 3.328 9.767 7.832 11.326 12.101.534-1.547.069-3.678-1.328-5.973"
        fill="currentColor"
        opacity=".55"
      />
    </svg>
  );
}

/** LI.FI, Morpho, and 1inch already have canonical app marks in this package. */
export function LifiSkillIcon(props: SkillIconProps) {
  return <LifiIcon viewBox="-2.8668 -3.1999 38.3992 38.3992" {...props} />;
}

export function MorphoSkillIcon(props: SkillIconProps) {
  return <MorphoIcon viewBox="-2.1448 -2.8688 25.7376 25.7376" {...props} />;
}

export function OneInchSkillIcon(props: SkillIconProps) {
  return <OneInchIcon viewBox="1.1992 1.1994 21.6007 21.6007" {...props} />;
}

/** Source and presentation notes: assets/README.md. */
export function OpenbookSkillIcon(props: SkillIconProps) {
  return <SourcedSkillIcon mark="openbook" {...props} />;
}

/** The canonical Optimism bridge uses the official Optimism mark. */
export function OptimismNativeSkillIcon(props: SkillIconProps) {
  return <OptimismIcon viewBox="1.2000 1.1995 21.6000 21.6000" {...props} />;
}

/** Source and presentation notes: assets/README.md. */
export function PendleSkillIcon(props: SkillIconProps) {
  return <SourcedSkillIcon mark="pendle" {...props} />;
}

/** Source and presentation notes: assets/README.md. */
export function RaydiumSkillIcon(props: SkillIconProps) {
  return <SourcedSkillIcon mark="raydium" {...props} />;
}

/** Source and presentation notes: assets/README.md. */
export function RenzoSkillIcon(props: SkillIconProps) {
  return <SourcedSkillIcon mark="renzo" {...props} />;
}

/** Robinhood Chain is also the underlying mark for Robinhood stock tokens. */
export function RobinhoodStocksSkillIcon(props: SkillIconProps) {
  return <RobinhoodIcon viewBox="4.0003 4.9996 24.0005 24.0005" {...props} />;
}

/** Source and presentation notes: assets/README.md. */
export function RocketPoolSkillIcon(props: SkillIconProps) {
  return <SourcedSkillIcon mark="rocket_pool" {...props} />;
}

/** Source and presentation notes: assets/README.md. */
export function SanctumSkillIcon(props: SkillIconProps) {
  return <SourcedSkillIcon mark="sanctum" {...props} />;
}

/** Source and presentation notes: assets/README.md. */
export function SquadsSkillIcon(props: SkillIconProps) {
  return <SourcedSkillIcon mark="squads" {...props} />;
}

/** Source and presentation notes: assets/README.md. */
export function StargateSkillIcon(props: SkillIconProps) {
  return <SourcedSkillIcon mark="stargate" {...props} />;
}

/** Source and presentation notes: assets/README.md. */
export function SushiSwapSkillIcon(props: SkillIconProps) {
  return <SourcedSkillIcon mark="sushiswap" {...props} />;
}

/** Source and presentation notes: assets/README.md. */
export function UniswapSkillIcon(props: SkillIconProps) {
  return <SourcedSkillIcon mark="uniswap" {...props} />;
}

export function YearnSkillIcon(props: SkillIconProps) {
  return <YearnIcon viewBox="1.2005 1.2000 21.6000 21.6000" {...props} />;
}

/** Source and presentation notes: assets/README.md. */
export function ZkSyncEraSkillIcon(props: SkillIconProps) {
  return <SourcedSkillIcon mark="zksync_era_native" {...props} />;
}

export function ZoraSkillIcon(props: SkillIconProps) {
  const gradientId = useId();
  return (
    <svg
      viewBox="1.1969 1.2000 21.6000 21.6000"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      <path
        fill={`url(#${gradientId})`}
        d="M12 21a9 9 0 1 1 0-18a9 9 0 0 1 0 18"
      />
      <defs>
        <radialGradient
          id={gradientId}
          cx="0"
          cy="0"
          r="1"
          gradientTransform="translate(16.086 7.84)scale(-15.2029)"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset=".007" stopColor="currentColor" stopOpacity=".12" />
          <stop offset=".191" stopColor="currentColor" stopOpacity=".28" />
          <stop offset=".498" stopColor="currentColor" stopOpacity=".6" />
          <stop offset=".667" stopColor="currentColor" stopOpacity=".82" />
          <stop offset=".823" stopColor="currentColor" />
          <stop offset="1" stopColor="currentColor" stopOpacity=".42" />
        </radialGradient>
      </defs>
    </svg>
  );
}

export function AvantisSkillIcon(props: SkillIconProps) {
  return <SourcedSkillIcon mark="avantis" {...props} />;
}

export function CctpSkillIcon(props: SkillIconProps) {
  return <SourcedSkillIcon mark="cctp" {...props} />;
}

export function DebridgeSkillIcon(props: SkillIconProps) {
  return <SourcedSkillIcon mark="debridge" {...props} />;
}

export function DriftSkillIcon(props: SkillIconProps) {
  return <SourcedSkillIcon mark="drift" {...props} />;
}

export function EigenlayerSkillIcon(props: SkillIconProps) {
  return <SourcedSkillIcon mark="eigenlayer" {...props} />;
}

export function KelpSkillIcon(props: SkillIconProps) {
  return <SourcedSkillIcon mark="kelp" {...props} />;
}

export function LidoSkillIcon(props: SkillIconProps) {
  return <SourcedSkillIcon mark="lido" {...props} />;
}

export function MantleStakedEthSkillIcon(props: SkillIconProps) {
  return <SourcedSkillIcon mark="mantle_staked_eth" {...props} />;
}

export function MarinadeSkillIcon(props: SkillIconProps) {
  return <SourcedSkillIcon mark="marinade" {...props} />;
}

export function MeteoraSkillIcon(props: SkillIconProps) {
  return <SourcedSkillIcon mark="meteora" {...props} />;
}

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
 * Skill IDs are wire values, so keep their presentation mapping in one place.
 * Unsupported or user-defined skills deliberately return `undefined` so the
 * caller can use the neutral wand fallback instead of inventing a protocol
 * identity.
 */
const SKILL_ICONS: Record<string, FC<SVGProps<SVGSVGElement>>> = {
  avantis: AvantisSkillIcon,
  debridge: DebridgeSkillIcon,
  drift: DriftSkillIcon,
  eigenlayer: EigenlayerSkillIcon,
  kelp: KelpSkillIcon,
  lido: LidoSkillIcon,
  mantle_staked_eth: MantleStakedEthSkillIcon,
  marinade: MarinadeSkillIcon,
  meteora: MeteoraSkillIcon,
  dummy: FlaskConicalIcon,
  krexa: KrexaSkillIcon,
  aave: AaveSkillIcon,
  across: AcrossSkillIcon,
  aerodrome: AerodromeSkillIcon,
  arbitrum_bridge: ArbitrumBridgeSkillIcon,
  base_native: BaseNativeSkillIcon,
  compound: CompoundSkillIcon,
  convex: ConvexSkillIcon,
  curve: CurveSkillIcon,
  cctp: CctpSkillIcon,
  // Common ERC-20 exposes standard token operations, so reuse the same coin
  // mark shown for unknown ERC-20 assets in transaction and trace UI.
  common_erc20: CoinsIcon,
  etherfi: EtherfiSkillIcon,
  jupiter: JupiterSkillIcon,
  kamino: KaminoSkillIcon,
  lifi_swap: LifiSkillIcon,
  morpho: MorphoSkillIcon,
  oneinch: OneInchSkillIcon,
  openbook: OpenbookSkillIcon,
  optimism_native: OptimismNativeSkillIcon,
  pendle: PendleSkillIcon,
  raydium: RaydiumSkillIcon,
  renzo: RenzoSkillIcon,
  robinhood_stocks: RobinhoodStocksSkillIcon,
  rocket_pool: RocketPoolSkillIcon,
  sanctum: SanctumSkillIcon,
  squads: SquadsSkillIcon,
  stargate: StargateSkillIcon,
  sushiswap: SushiSwapSkillIcon,
  uniswap: UniswapSkillIcon,
  yearn: YearnSkillIcon,
  zksync_era_native: ZkSyncEraSkillIcon,
  zora: ZoraSkillIcon,
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
  return SKILL_ICONS[normalizeSkillId(skillId)];
}
